// Promise-based wrappers around the prompt and confirm modals in index.html.
// Replace the browser's blocking window.prompt / window.confirm.

import { openModal, closeModal } from './modals.js';

export function confirmDialog({ title = 'Confirm', message, confirmLabel = 'Confirm', danger = true } = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message ?? 'Are you sure?';
    const okBtn = document.getElementById('confirmActionBtn');
    const cancelBtn = document.getElementById('cancelConfirmBtn');
    const closeBtn = document.getElementById('closeConfirmModalBtn');
    okBtn.textContent = confirmLabel;
    okBtn.classList.toggle('btn-danger', !!danger);

    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    };
    const finish = (val) => {
      cleanup();
      closeModal(modal);
      resolve(val);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onBackdrop = (e) => { if (e.target === modal) finish(false); };
    const onKey = (e) => { if (e.key === 'Escape') finish(false); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    openModal(modal);
    okBtn.focus();
  });
}

export function promptDialog({
  title = 'Enter Value',
  label = 'Value:',
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'OK',
  maxLength = 50,
  validate, // optional (value) => string | null   (return null if valid)
} = {}) {
  return new Promise((resolve) => {
    const modal = document.getElementById('promptModal');
    document.getElementById('promptTitle').textContent = title;
    const labelEl = document.getElementById('promptLabel');
    labelEl.textContent = label;
    const input = document.getElementById('promptInput');
    const errEl = document.getElementById('promptError');
    const okBtn = document.getElementById('confirmPromptBtn');
    const cancelBtn = document.getElementById('cancelPromptBtn');
    const closeBtn = document.getElementById('closePromptModalBtn');

    input.value = defaultValue;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    okBtn.textContent = confirmLabel;
    errEl.textContent = '';
    errEl.style.display = 'none';

    const cleanup = () => {
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      closeBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    };
    const finish = (val) => {
      cleanup();
      closeModal(modal);
      resolve(val);
    };
    const showError = (msg) => {
      errEl.textContent = msg;
      errEl.style.display = '';
    };
    const onOk = () => {
      const value = input.value.trim();
      if (validate) {
        const error = validate(value);
        if (error) {
          showError(error);
          return;
        }
      }
      finish(value);
    };
    const onCancel = () => finish(null);
    const onBackdrop = (e) => { if (e.target === modal) finish(null); };
    const onKey = (e) => {
      if (e.key === 'Escape') finish(null);
      if (e.key === 'Enter' && document.activeElement === input) {
        e.preventDefault();
        onOk();
      }
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    openModal(modal);
    input.focus();
    input.select();
  });
}
