// Starts the Vite dev server and keeps the checkout in sync with the remote
// branch. New commits are fast-forwarded every few seconds and Vite reloads
// the page by itself, so there is no need to pull and restart by hand.
//
//   npm run follow          (localhost)
//   npm run follow -- lan   (HTTPS on the local network, e.g. for an iPad)
import { spawn, execSync } from 'node:child_process';

const INTERVAL_MS = 5000;
const lan = process.argv.includes('lan');
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const branch = sh('git rev-parse --abbrev-ref HEAD');
console.log(`[follow] tracking origin/${branch}, checking every ${INTERVAL_MS / 1000} s`);

function startVite() {
  const args = ['vite', ...(lan ? ['--mode', 'lan'] : [])];
  return spawn('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
}

execSync('npm run assets', { stdio: 'inherit' });
let vite = startVite();

setInterval(() => {
  try {
    sh(`git fetch --quiet origin ${branch}`);
    const behind = Number(sh(`git rev-list --count HEAD..origin/${branch}`));
    if (behind === 0) return;
    if (sh('git status --porcelain --untracked-files=no')) {
      console.log('[follow] new commits available, but you have local changes; not pulling');
      return;
    }
    const changed = sh(`git diff --name-only HEAD origin/${branch}`).split('\n');
    sh(`git merge --ff-only --quiet origin/${branch}`);
    console.log(`[follow] pulled ${behind} commit(s): ${sh('git log -1 --format=%s')}`);
    if (changed.some((f) => /(^|\/)package(-lock)?\.json$/.test(f) || /(^|\/)vite\.config/.test(f))) {
      console.log('[follow] dependencies or config changed: installing and restarting Vite');
      vite.kill();
      execSync('npm install', { stdio: 'inherit' });
      execSync('npm run assets', { stdio: 'inherit' });
      vite = startVite();
    }
  } catch (e) {
    console.log(`[follow] ${e.message.split('\n')[0]}`);
  }
}, INTERVAL_MS);

process.on('SIGINT', () => {
  vite.kill();
  process.exit(0);
});
