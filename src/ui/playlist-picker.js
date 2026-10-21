import { escapeHtml, formatCount } from './stations-format.js';

export function eligibleLists(lists = []) {
  return (Array.isArray(lists) ? lists : []).filter((list) => (
    list
    && list.id !== '__community__'
    && !list.readOnly
    && Array.isArray(list.stations)
    && list.stations.length > 0
  ));
}

function pluralStations(count) {
  return `${formatCount(count)} station${count === 1 ? '' : 's'}`;
}

function listStep(lists) {
  if (!lists.length) {
    return '<p class="stations-playlist-empty">You have no shareable lists yet. Create a list with at least one station first.</p>';
  }
  return `
    <div class="stations-playlist-list">
      ${lists.map((list) => `
        <button type="button" class="stations-playlist-row" data-playlist-select="${escapeHtml(list.id)}">
          <span class="stations-playlist-row-copy">
            <strong>${escapeHtml(list.name)}</strong>
            <span>${pluralStations(list.stations.length)}</span>
          </span>
          <span class="stations-playlist-row-arrow" aria-hidden="true">→</span>
        </button>
      `).join('')}
    </div>
  `;
}

function formStep(selected, title, note, submitterName, submitterContact, error, submitting) {
  const value = title || selected.name;
  return `
    <button type="button" class="stations-playlist-back" data-playlist-back>← Back to lists</button>
    <p class="stations-playlist-help">Your name and the selected list are sent for review. Email or contact is optional and only used to reach you about this submission.</p>
    <form class="stations-playlist-form" data-playlist-form>
      <label class="stations-playlist-field">
        <span>Collection title</span>
        <input id="playlistTitle" name="title" maxlength="60" value="${escapeHtml(value)}" required />
      </label>
      <label class="stations-playlist-field">
        <span>Your name</span>
        <input id="playlistSubmitterName" name="submitterName" maxlength="60" value="${escapeHtml(submitterName)}" required />
      </label>
      <label class="stations-playlist-field">
        <span>Email or contact <em>optional</em></span>
        <input id="playlistSubmitterContact" name="submitterContact" maxlength="120" value="${escapeHtml(submitterContact)}" placeholder="So the editors can reach you about this collection." />
      </label>
      <label class="stations-playlist-field">
        <span>Note <em>optional</em></span>
        <textarea id="playlistNote" name="note" maxlength="280" rows="3" placeholder="Tell the editor what makes this collection special.">${escapeHtml(note)}</textarea>
      </label>
      ${error ? `<p class="stations-playlist-error" role="alert">${escapeHtml(error)}</p>` : ''}
      <button type="submit" class="stations-pill stations-playlist-submit" data-playlist-submit${submitting ? ' disabled aria-disabled="true"' : ''}>${submitting ? 'Submitting…' : 'Submit for review'}</button>
    </form>
  `;
}

function successStep() {
  return `
    <div class="stations-playlist-success">
      <p><strong>Submitted for review.</strong> Your collection will be reviewed and published if it fits.</p>
      <button type="button" class="stations-pill" data-playlist-close>Done</button>
    </div>
  `;
}

export function pickerHtml({
  lists = [],
  selected = null,
  title = '',
  note = '',
  submitterName = '',
  submitterContact = '',
  error = '',
  submitting = false,
  success = false,
  loading = false,
} = {}) {
  let body = '';
  if (success) body = successStep();
  else if (loading) body = '<p class="stations-playlist-help">Loading your lists…</p>';
  else if (selected) body = formStep(selected, title, note, submitterName, submitterContact, error, submitting);
  else body = listStep(lists);

  return `
    <div class="stations-playlist-head">
      <div>
        <p class="stations-kicker">Community collections</p>
        <h3 id="playlistPickerTitle">Suggest a collection</h3>
      </div>
      <button type="button" class="stations-icon-btn" data-playlist-close aria-label="Close collection submission">×</button>
    </div>
    <div class="stations-playlist-body">${body}</div>
  `;
}
