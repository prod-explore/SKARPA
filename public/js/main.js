/**
 * main.js — Frontend JavaScript
 * Animacje, interakcje, UX enhancements
 */

// Animacja wejścia elementów przy scrollu
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.feature-card, .class-card, .calendar-row').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(20px)';
  el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
  observer.observe(el);
});

// Flash query params -> alert
const params = new URLSearchParams(window.location.search);
const success = params.get('success');
const info    = params.get('info');
const error   = params.get('error');

function showFlash(msg, type) {
  if (!msg) return;
  const div = document.createElement('div');
  div.className = `alert alert--${type}`;
  div.textContent = decodeURIComponent(msg);
  div.style.cssText = 'position:fixed;top:80px;right:20px;z-index:999;max-width:360px;animation:slideIn 0.3s ease';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

const style = document.createElement('style');
style.textContent = '@keyframes slideIn { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }';
document.head.appendChild(style);

showFlash(success, 'success');
showFlash(info, 'info');
showFlash(error, 'error');

// Usuń query params z URL po wyświetleniu
if (success || info || error) {
  const url = new URL(window.location);
  url.searchParams.delete('success');
  url.searchParams.delete('info');
  url.searchParams.delete('error');
  window.history.replaceState({}, '', url);
}
