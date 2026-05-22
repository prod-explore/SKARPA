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

// Custom Confirmation Modal
document.addEventListener('DOMContentLoaded', () => {
  const formsWithConfirm = document.querySelectorAll('form[data-confirm]');
  
  if (formsWithConfirm.length > 0) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'confirm-modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'confirm-modal';
    
    const modalText = document.createElement('p');
    modalText.className = 'confirm-modal-text';
    
    const modalActions = document.createElement('div');
    modalActions.className = 'confirm-modal-actions';
    
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn--outline';
    btnCancel.type = 'button';
    btnCancel.textContent = 'Anuluj';
    
    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'btn btn--danger';
    btnConfirm.type = 'button';
    btnConfirm.textContent = 'Potwierdź';
    
    modalActions.appendChild(btnCancel);
    modalActions.appendChild(btnConfirm);
    
    modal.appendChild(modalText);
    modal.appendChild(modalActions);
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);
    
    const style = document.createElement('style');
    style.textContent = `
      .confirm-modal-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: none; align-items: center; justify-content: center;
        z-index: 10000;
        backdrop-filter: blur(4px);
        opacity: 0; transition: opacity 0.2s ease;
      }
      .confirm-modal-overlay.active {
        display: flex; opacity: 1;
      }
      .confirm-modal {
        background: var(--bg);
        padding: 2rem;
        border-radius: var(--radius);
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        max-width: 400px; width: 90%;
        text-align: center;
        transform: scale(0.9); transition: transform 0.2s ease;
      }
      .confirm-modal-overlay.active .confirm-modal {
        transform: scale(1);
      }
      .confirm-modal-text {
        font-size: 1.1rem; margin-bottom: 1.5rem; color: var(--text);
      }
      .confirm-modal-actions {
        display: flex; gap: 1rem; justify-content: center;
      }
    `;
    document.head.appendChild(style);
    
    let pendingForm = null;
    
    const closeOverlay = () => {
      modalOverlay.classList.remove('active');
      setTimeout(() => {
        if (!modalOverlay.classList.contains('active')) {
          modalOverlay.style.display = 'none';
        }
      }, 200);
      pendingForm = null;
    };
    
    formsWithConfirm.forEach(form => {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        pendingForm = form;
        modalText.textContent = form.getAttribute('data-confirm');
        
        if (form.querySelector('.btn--danger')) {
           btnConfirm.className = 'btn btn--danger';
        } else if (form.querySelector('.btn--warning')) {
           btnConfirm.className = 'btn btn--warning';
        } else {
           btnConfirm.className = 'btn btn--primary';
        }

        modalOverlay.style.display = 'flex';
        modalOverlay.offsetHeight; // force reflow
        modalOverlay.classList.add('active');
      });
    });
    
    btnCancel.addEventListener('click', closeOverlay);
    
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) closeOverlay();
    });
    
    btnConfirm.addEventListener('click', () => {
      if (pendingForm) {
        pendingForm.submit();
      }
    });
  }
});
