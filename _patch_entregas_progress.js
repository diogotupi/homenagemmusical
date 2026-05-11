const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "entregas");
const old = `        progressBar.addEventListener('click', (e) => {
            const rect = progressBar.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            audio.currentTime = pos * audio.duration;
        });`;
const newBlock = `        function seekFromProgressClientX(clientX) {
            if (!audio.duration || !Number.isFinite(audio.duration)) return;
            const rect = progressBar.getBoundingClientRect();
            if (rect.width <= 0) return;
            const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            audio.currentTime = pos * audio.duration;
        }

        progressBar.addEventListener('click', (e) => seekFromProgressClientX(e.clientX));

        let progressScrubbing = false;
        progressBar.addEventListener('touchstart', (e) => {
            if (!e.touches.length) return;
            progressScrubbing = true;
            seekFromProgressClientX(e.touches[0].clientX);
        }, { passive: true });

        progressBar.addEventListener('touchmove', (e) => {
            if (!progressScrubbing || !e.touches.length) return;
            e.preventDefault();
            seekFromProgressClientX(e.touches[0].clientX);
        }, { passive: false });

        progressBar.addEventListener('touchend', () => { progressScrubbing = false; });
        progressBar.addEventListener('touchcancel', () => { progressScrubbing = false; });`;
const cssOld = `        .progress-bar {
            flex: 1;
            height: 4px;
            background: #4d4d4d;
            border-radius: 2px;
            position: relative;
            cursor: pointer;
        }`;
const cssNew = `        .progress-bar {
            flex: 1;
            height: 4px;
            background: #4d4d4d;
            border-radius: 2px;
            position: relative;
            cursor: pointer;
            touch-action: none;
        }`;
for (const f of fs.readdirSync(root).filter((x) => x.endsWith(".html"))) {
  const p = path.join(root, f);
  let t = fs.readFileSync(p, "utf8");
  if (!t.includes(old)) { console.log("skip", f); continue; }
  t = t.replace(old, newBlock);
  if (t.includes(cssOld)) t = t.replace(cssOld, cssNew);
  fs.writeFileSync(p, t);
  console.log("patched", f);
}
