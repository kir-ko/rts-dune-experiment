let toastTimer: number | null = null;

export function showToast(message: string, duration = 3000): void {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  if (toastTimer !== null) clearTimeout(toastTimer);

  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);

  toastTimer = window.setTimeout(() => {
    el.remove();
    toastTimer = null;
  }, duration);
}
