// Allowlist-gated shell MCP tool, in-house (npm `shell-mcp` has no real whitelist) — rationale: docs/plan/done/init.md
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { loadAllowlist, loadAllowlistDirs, readSettings } from './allowlist.js';
import { getRoots, resolveUnderRoot, containedIn, overlaps } from './roots.js';
import { ok, err, fail } from './mcp-tool.js';

// Interpreters run a script file passed as an argument, so trust must follow the script's path, not the interpreter binary (which lives on PATH, outside the trusted zones). Shells (sh/bash/zsh) are excluded on purpose — their argument is arbitrary code, not a file to locate under a zone.
const INTERPRETERS = new Set(['node', 'python', 'python3', 'bun', 'deno', 'tsx', 'ruby', 'perl', 'php']);

// ls-remote requires zero extra args — a repository/URL argument lets git's own ext:: transport helper spawn an arbitrary process before anything "read-only" happens; bare invocation only queries the configured remote.
const GIT_NO_ARGS_SUBCOMMANDS = new Set(['ls-remote']);

// `npm run <script>`, `npm test` and their lifecycle hooks execute whatever string package.json
// holds, and every root is writable through write_file — so gating the binary name alone made npm a
// general-purpose exec tool. Three checks replace that: which script names may run, that the body is
// a single command which itself passes the allowlist, and that npm is not pointed at another
// package.json. Hooks are dropped (--ignore-scripts) because prelint/postlint are bodies nobody
// asked to run. A package whose scripts the user has read can be listed in setting.json
// shell.trustedPackages, which skips the body check for that directory only.
const NPM_SCRIPT_SUBCOMMANDS = new Set(['run', 'run-script', 'test']);
const DEFAULT_NPM_SCRIPTS = ['lint', 'test', 'typecheck', 'type-check'];
// Flags that move npm off the validated cwd. checkArgPaths cannot catch them: it skips any argument
// starting with '-', so --prefix=/elsewhere never reached it.
const NPM_REDIRECT_FLAG = /^(--prefix|--cwd|-C$|-w$|--workspace|--workspaces|--include-workspace-root)/;

// Subcommand-level flags that turn a read-only git command into a program launcher or a file writer:
// --ext-diff/--textconv run diff.external and diff.<driver>.textconv, both named by the repository's
// own .git/config, which lives inside a writable root; --output writes wherever it is told. Global
// options (-c, --git-dir, --exec-path) are already unreachable because checkPermission requires
// args[0] to be an allowlisted subcommand, and `-c` after a subcommand is git's combined-diff flag.
const GIT_FORBIDDEN_ARG = /^(--ext-diff$|--textconv$|--output$|--output=|--upload-pack|--receive-pack|--exec-path|--git-dir|--work-tree)/;
// Injected as -c, which outranks .git/config: fsmonitor and sshCommand are the remaining keys that
// name a program git spawns during read-only work, and ext:: is a transport that is one.
const GIT_SAFE_CONFIG = ['-c', 'core.fsmonitor=false', '-c', 'core.sshCommand=false', '-c', 'protocol.ext.allow=never'];
// Verified against this git: log/diff/show accept both flags, blame accepts --no-textconv only.
const GIT_NO_EXTERNAL = { log: ['--no-ext-diff', '--no-textconv'], diff: ['--no-ext-diff', '--no-textconv'], show: ['--no-ext-diff', '--no-textconv'], blame: ['--no-textconv'] };

const settingsList = (value, fallback) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.trim()) : fallback);
const npmScriptNames = () => settingsList(readSettings().shell?.npmScripts, DEFAULT_NPM_SCRIPTS);
const trustedPackages = () => settingsList(readSettings().shell?.trustedPackages, []).map((p) => path.resolve(p));

function packageScripts(cwd) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  } catch {
    return {};
  }
}

// A real lint or test run on a real project overruns 10s (an eslint config with projectService
// type-checks the whole project first), and the SIGTERM is invisible: the killed process never
// gets to print, so the caller sees a bare "Command failed" and misreads it as a config error.
// Env-configurable, old values as defaults.
const TIMEOUT_MS = Number(process.env.MCP_SHELL_TIMEOUT_MS) || 10_000;
const MAX_BUFFER = Number(process.env.MCP_SHELL_MAX_BUFFER) || 1024 * 1024;

// Defence in depth for the same two mechanisms: a program can also be named through the environment
// the child inherits (GIT_EXTERNAL_DIFF survives --no-ext-diff on older git, GIT_PAGER runs on a
// tty), and npm_config_ignore_scripts keeps hooks off even if the argv rewrite is ever bypassed.
const SAFE_ENV = { ...process.env, GIT_EXTERNAL_DIFF: 'cat', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', npm_config_ignore_scripts: 'true' };

const warnedDirs = new Set();
// A trusted dir inside a writable filesystem root would let write_file + run_cmd become arbitrary code execution with no allowlist review in between. Drop it, fail-safe, and say why once.
function activeTrustedDirs() {
  return loadAllowlistDirs().filter((dir) => {
    const clash = getRoots().find((root) => overlaps(dir, root));
    if (clash && !warnedDirs.has(dir)) {
      warnedDirs.add(dir);
      process.stderr.write(`[shell] trusted dir ignored — overlaps writable root ${clash} (write+exec = RCE): ${dir}\n`);
    }
    return !clash;
  });
}

// realpath first so a symlink pointing out of a zone can't masquerade as being inside it; a non-existent path can't be a trusted script, so a throw here is a correct "no".
function underTrusted(p, dirs) {
  try {
    const abs = fs.realpathSync(path.resolve(p));
    return dirs.some((dir) => containedIn(abs, dir));
  } catch {
    return false;
  }
}

function preallowedByDir(bin, args) {
  const dirs = activeTrustedDirs();
  if (!dirs.length) return false;
  if (bin.includes('/') || bin.includes('\\')) {
    if (!underTrusted(bin, dirs)) return false;
    try {
      fs.accessSync(fs.realpathSync(path.resolve(bin)), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  if (INTERPRETERS.has(path.basename(bin))) {
    const script = args.find((a) => !a.startsWith('-')); // first non-flag arg is the script; `node -e '<code>'` has none under a zone, so it stays blocked
    return script ? underTrusted(script, dirs) : false;
  }
  return false;
}

class Shell {
  // Backslash is escape/chaining on Unix but the normal path separator on Windows — only treat it as dangerous off-Windows.
  // No backslash: `execFile` never spawns a shell, so it is an inert literal everywhere and a path separator on Windows.
  static DANGEROUS_CHARS = /[;&|`$<>\n]/;

  // Quotes group an argument and are then stripped, as a shell would. Splitting on whitespace alone left them in the argv, so `find -name "*.ts"` silently searched for a name containing quote marks.
  static tokenize(command) {
    const tokens = [];
    let current = '';
    let started = false;
    let quote = null;
    for (const char of command.trim()) {
      if (quote) {
        if (char === quote) quote = null;
        else current += char;
      } else if (char === '"' || char === "'") {
        quote = char;
        started = true;
      } else if (/\s/.test(char)) {
        if (started) tokens.push(current);
        current = '';
        started = false;
      } else {
        current += char;
        started = true;
      }
    }
    if (quote) throw new Error('unterminated quote');
    if (started) tokens.push(current);
    return tokens;
  }

  parse(command) {
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error('empty command');
    }
    if (Shell.DANGEROUS_CHARS.test(command)) {
      throw new Error('command chaining/redirection is not allowed');
    }
    const [bin, ...args] = Shell.tokenize(command);
    if (!bin) throw new Error('empty command');
    return { bin, args };
  }

  // The allowlist gates the binary; nothing gated its arguments, so `cat` alone authorized
  // `cat ~/.ssh/id_rsa` even though that path is outside every configured root — cwd was the
  // only thing ever checked. Only path-shaped args are inspected: absolute ones directly,
  // relative ones resolved against the (already validated) cwd. That keeps `git log origin/main`
  // working while `cat ../../../etc/passwd` stops.
  checkArgPaths(args, cwd) {
    for (const arg of args) {
      if (arg.startsWith('-')) continue;
      if (!path.isAbsolute(arg) && !arg.includes('/') && !arg.includes('\\')) continue;
      const abs = path.isAbsolute(arg) ? path.resolve(arg) : path.resolve(cwd, arg);
      if (!getRoots().some((root) => containedIn(abs, root))) {
        throw new Error(`argument path is outside the allowed roots: ${arg}`);
      }
    }
  }

  // The body is what actually executes, so it goes through the same gate as a typed command. A bare
  // name that resolves under cwd/node_modules/.bin is also accepted: that is the project toolchain a
  // lint or test script exists to invoke, and it cannot be satisfied from PATH.
  checkScriptBody(name, body, cwd) {
    if (Shell.DANGEROUS_CHARS.test(body)) {
      throw new Error(`npm script "${name}" is not a single command: ${body} — chaining or redirection in a body is arbitrary code. Add ${cwd} to shell.trustedPackages once you have read it.`);
    }
    const [scriptBin, ...scriptArgs] = Shell.tokenize(body);
    if (!scriptBin) throw new Error(`npm script "${name}" is empty`);
    try {
      this.checkPermission(scriptBin, scriptArgs);
    } catch (e) {
      const local = path.join(cwd, 'node_modules', '.bin', scriptBin);
      if (/[/\\]/.test(scriptBin) || !fs.existsSync(local)) {
        throw new Error(`npm script "${name}" runs "${scriptBin}", which is neither allowlisted nor a local node_modules/.bin entry — ${e.message}`);
      }
    }
    this.checkArgPaths(scriptArgs, cwd);
  }

  // Returns the argv to run: the requested script, minus its hooks. `npm test` is rewritten to
  // `npm run test` because --ignore-scripts on the lifecycle form skips the run itself.
  npmArgs(args, cwd) {
    const rest = args.slice(1).filter((a) => a !== '--ignore-scripts');
    const redirect = rest.find((a) => NPM_REDIRECT_FLAG.test(a));
    if (redirect) throw new Error(`"${redirect}" is not allowed: it points npm at a package.json outside the validated cwd`);
    const isTest = args[0] === 'test';
    if (isTest ? rest.length : rest.length > 1) {
      throw new Error('extra arguments are not allowed here: npm forwards them to the runner, whose own flags (--config, --require) load arbitrary code');
    }
    const name = isTest ? 'test' : rest[0];
    if (!name) return args; // bare `npm run` only lists the scripts
    if (trustedPackages().some((dir) => cwd === dir || containedIn(cwd, dir))) return args;
    const allowed = npmScriptNames();
    if (!allowed.includes(name)) throw new Error(`npm script "${name}" is not in shell.npmScripts (${allowed.join(', ')})`);
    const body = packageScripts(cwd)[name];
    if (typeof body !== 'string' || !body.trim()) throw new Error(`no "${name}" script in ${path.join(cwd, 'package.json')}`);
    this.checkScriptBody(name, body, cwd);
    return ['run', name, '--ignore-scripts'];
  }

  gitArgs(args) {
    const forbidden = args.find((a) => GIT_FORBIDDEN_ARG.test(a));
    if (forbidden) {
      throw new Error(`"git ${forbidden}" is not allowed: it runs a program named by the repository's own config, or writes outside the diff`);
    }
    // Flags go straight after the subcommand, never at the end, where a pathspec after `--` would
    // swallow them.
    return [...GIT_SAFE_CONFIG, args[0], ...(GIT_NO_EXTERNAL[args[0]] ?? []), ...args.slice(1)];
  }

  // Same idea as checkArgPaths one level down: the allowlist gates the binary, this gates what the
  // binary is then told to load or spawn.
  harden(bin, args, cwd) {
    if (bin === 'npm' && NPM_SCRIPT_SUBCOMMANDS.has(args[0])) return this.npmArgs(args, cwd);
    if (bin === 'git' && args.length) return this.gitArgs(args);
    return args;
  }

  checkPermission(bin, args) {
    const allowlist = loadAllowlist();
    if (bin in allowlist) {
      const allowedSubcommands = allowlist[bin];
      if (!Array.isArray(allowedSubcommands) || allowedSubcommands.includes(args[0])) {
        if (bin === 'git' && GIT_NO_ARGS_SUBCOMMANDS.has(args[0]) && args.length > 1) {
          throw new Error(`"git ${args[0]}" only allowed with no further arguments — a repository/URL argument can smuggle code execution via git's transport helpers (ext::, --upload-pack=)`);
        }
        return;
      }
    }
    if (preallowedByDir(bin, args)) return; // not named (or the named subcommand is blocked), but it targets a script under a trusted zone
    throw new Error(`"${bin}${args[0] ? ` ${args[0]}` : ''}" is not in the allowlist`);
  }

  run(bin, args, cwd) {
    return new Promise((resolve) => {
      execFile(bin, args, { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true, env: SAFE_ENV }, (error, stdout, stderr) => {
        if (error) {
          // Linters and test runners report their findings on stdout and exit non-zero.
          // Dropping stdout here turned "12 lint errors" into "Command failed" with no detail.
          const note = error.killed || error.signal ? `timed out after ${TIMEOUT_MS}ms — raise MCP_SHELL_TIMEOUT_MS\n` : '';
          resolve(err(`${note}${[stderr, stdout].filter(Boolean).join('\n') || error.message}`));
        } else {
          resolve(ok(stdout || '(no output)'));
        }
      });
    });
  }

  async execute(command, cwd) {
    let bin, args, dir;
    try {
      ({ bin, args } = this.parse(command));
      this.checkPermission(bin, args);
      dir = resolveUnderRoot(cwd);
      this.checkArgPaths(args, dir);
      args = this.harden(bin, args, dir);
    } catch (e) {
      return fail(e);
    }
    return this.run(bin, args, dir);
  }
}

const shell = new Shell();

export function register(server) {
  server.registerTool(
    'run_cmd',
    {
      title: 'Run Command',
      description: 'Run one shell command from the allowlist. Ships a read-only default set (ls, cat, grep, head, tail, stat, git status/log/diff/show, …), extendable in the local control panel. Use the search tools (find_path/search_content) for file/text lookup — find is not in the set because its own flags escape read-only. Pass cwd (absolute path under an allowed root, or relative to the first configured root) to run inside a specific project directory — this is how you target a repo. No chaining, no redirection — one command per call.',
      inputSchema: { command: z.string(), cwd: z.string().optional() },
    },
    ({ command, cwd }) => shell.execute(command, cwd),
  );
}
