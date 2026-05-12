// Decorative ambient effects.
export function startAmbient() {
  // Hash field
  const f = document.getElementById('hashField');
  if (f && !f.children.length) {
    const glyphs = ['#', '#', '#', '/', '·', '#'];
    for (let i = 0; i < 20; i++) {
      const e = document.createElement('span');
      e.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      e.style.left = Math.random() * 100 + '%';
      e.style.fontSize = (Math.random() * 22 + 14) + 'px';
      e.style.animationDuration = (Math.random() * 30 + 20) + 's';
      e.style.animationDelay = -Math.random() * 30 + 's';
      f.appendChild(e);
    }
  }
  // Bubbles
  const b = document.getElementById('bubbles');
  if (b && !b.children.length) {
    for (let i = 0; i < 16; i++) {
      const el = document.createElement('div');
      el.className = 'bubble';
      const s = Math.random() * 22 + 6;
      el.style.width = s + 'px';
      el.style.height = s + 'px';
      el.style.left = Math.random() * 100 + '%';
      el.style.animationDuration = (Math.random() * 14 + 12) + 's';
      el.style.animationDelay = -Math.random() * 25 + 's';
      b.appendChild(el);
    }
  }
}
