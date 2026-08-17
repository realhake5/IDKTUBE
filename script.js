const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

const modal = $('#playerModal');
const playerFrame = $('#playerFrame');
const playerTitle = $('#playerTitle');
const playerMeta = $('#playerMeta');
const toast = $('#toast');
const videoGrid = $('#videoGrid');
const emptyState = $('#emptyState');
const feedTitle = $('#feedTitle');
const curatedFeedMarkup = videoGrid.innerHTML;
const API_BASE = 'https://www.googleapis.com/youtube/v3';
const storedKeyName = 'idktube-youtube-api-key';
let toastTimer;
let activeDataSource = 'curated';
let requestNumber = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function getApiKey(askForKey = false) {
  const configuredKey = (window.IDKTUBE_CONFIG?.youtubeApiKey || '').trim();
  if (configuredKey && configuredKey !== 'PASTE_YOUR_YOUTUBE_API_KEY_HERE') return configuredKey;

  let savedKey = '';
  try {
    savedKey = (localStorage.getItem(storedKeyName) || '').trim();
  } catch {
    // Private browsing can disable localStorage. The prompt still works.
  }
  if (savedKey) return savedKey;
  if (!askForKey) return '';

  const enteredKey = window.prompt(
    'Paste a YouTube Data API v3 browser key to enable live search and channel loading.\n\nThe key is saved only in this browser.'
  );
  const cleanKey = (enteredKey || '').trim();
  if (cleanKey) {
    try { localStorage.setItem(storedKeyName, cleanKey); } catch { /* no-op */ }
  }
  return cleanKey;
}

async function youtubeRequest(resource, params = {}) {
  const key = getApiKey();
  if (!key) {
    throw new Error('Live YouTube search needs a YouTube Data API key.');
  }

  const url = new URL(`${API_BASE}/${resource}`);
  Object.entries({ ...params, key }).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url);
  let data = {};
  try { data = await response.json(); } catch { /* handled by the status below */ }
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded') throw new Error('YouTube API quota exceeded for today.');
    if (reason === 'keyInvalid') throw new Error('That YouTube API key is invalid.');
    throw new Error(data?.error?.message || `YouTube returned HTTP ${response.status}.`);
  }
  return data;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character]));
}

function formatCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return '—';
  if (count >= 1e9) return `${(count / 1e9).toFixed(count >= 1e10 ? 0 : 1).replace('.0', '')}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(count >= 1e7 ? 0 : 1).replace('.0', '')}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(count >= 1e4 ? 0 : 1).replace('.0', '')}K`;
  return String(count);
}

function formatDuration(isoDuration = '') {
  const parts = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!parts) return '—';
  const hours = Number(parts[1] || 0);
  const minutes = Number(parts[2] || 0);
  const seconds = Number(parts[3] || 0);
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatAge(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return 'recently';
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const [unit, divisor] = units.find(([, size]) => seconds >= size) || ['second', 1];
  const amount = Math.floor(seconds / divisor);
  return `${amount} ${unit}${amount === 1 ? '' : 's'} ago`;
}

function thumbnailFor(snippet = {}) {
  return snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '';
}

function normalizeVideo(item, details = item) {
  const snippet = details.snippet || item.snippet || {};
  return {
    kind: 'video',
    id: item.id?.videoId || item.id,
    title: snippet.title || 'Untitled video',
    channel: snippet.channelTitle || 'YouTube',
    publishedAt: snippet.publishedAt,
    thumbnail: thumbnailFor(snippet),
    duration: formatDuration(details.contentDetails?.duration),
    views: formatCount(details.statistics?.viewCount),
  };
}

async function searchYouTube(query) {
  const searchResponse = await youtubeRequest('search', {
    part: 'snippet',
    q: query,
    type: 'video,channel',
    maxResults: '12',
  });
  const searchItems = searchResponse.items || [];
  const videoItems = searchItems.filter((item) => item.id?.videoId);
  const ids = videoItems.map((item) => item.id.videoId).join(',');
  let details = [];
  if (ids) {
    const detailsResponse = await youtubeRequest('videos', {
      part: 'snippet,contentDetails,statistics',
      id: ids,
    });
    details = detailsResponse.items || [];
  }
  const byId = new Map(details.map((item) => [item.id, item]));
  return searchItems.map((item) => {
    if (item.id?.channelId) {
      return {
        kind: 'channel',
        id: item.id.channelId,
        title: item.snippet?.channelTitle || item.snippet?.title || 'YouTube channel',
        description: item.snippet?.description || 'Open this channel to see its latest uploads.',
        thumbnail: thumbnailFor(item.snippet),
      };
    }
    return normalizeVideo(item, byId.get(item.id.videoId) || item);
  });
}

async function loadChannelVideos(channelId, channelTitle) {
  const currentRequest = ++requestNumber;
  feedTitle.textContent = `Loading ${channelTitle}…`;
  emptyState.hidden = true;
  try {
    const channelResponse = await youtubeRequest('channels', {
      part: 'contentDetails,snippet',
      id: channelId,
    });
    const channel = channelResponse.items?.[0];
    const uploadsId = channel?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) throw new Error('This channel does not expose a public uploads playlist.');

    const playlistResponse = await youtubeRequest('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsId,
      maxResults: '12',
    });
    const playlistItems = (playlistResponse.items || []).filter((item) => item.contentDetails?.videoId);
    const ids = playlistItems.map((item) => item.contentDetails.videoId).join(',');
    if (!ids) throw new Error('No public uploads were found on this channel.');

    const detailsResponse = await youtubeRequest('videos', {
      part: 'snippet,contentDetails,statistics',
      id: ids,
    });
    const details = new Map((detailsResponse.items || []).map((item) => [item.id, item]));
    const videos = playlistItems.map((item) => normalizeVideo(
      { id: item.contentDetails.videoId, snippet: item.snippet },
      details.get(item.contentDetails.videoId) || item
    ));
    if (currentRequest !== requestNumber) return;
    renderLiveVideos(videos, `${channelTitle} uploads`);
  } catch (error) {
    if (currentRequest !== requestNumber) return;
    showToast(error.message);
    feedTitle.textContent = 'For your next rabbit hole';
    emptyState.hidden = false;
  }
}

function renderVideoCard(video) {
  const title = escapeHtml(video.title);
  const channel = escapeHtml(video.channel);
  const thumb = escapeHtml(video.thumbnail);
  const duration = escapeHtml(video.duration);
  const age = escapeHtml(formatAge(video.publishedAt));
  const views = escapeHtml(video.views);
  return `<article class="video-card video-trigger" data-live="true" data-category="all" data-video-id="${escapeHtml(video.id)}" data-video-title="${title}" data-channel="${channel}" data-duration="${duration}">
    <div class="thumbnail"><img src="${thumb}" alt="${title}" loading="lazy" /><span class="duration">${duration}</span><button class="hover-play" aria-label="Play video"><svg><use href="#i-play"></use></svg></button></div>
    <div class="card-info"><div class="channel-avatar avatar-purple">${escapeHtml(channel.slice(0, 1).toUpperCase())}</div><div class="video-details"><h3>${title}</h3><p>${channel}</p><p>${views} views <span>•</span> ${age}</p></div><button class="more-button" aria-label="More options"><svg><use href="#i-more"></use></svg></button></div>
  </article>`;
}

function renderChannelCard(channel) {
  const title = escapeHtml(channel.title);
  const description = escapeHtml(channel.description);
  const thumb = escapeHtml(channel.thumbnail);
  return `<article class="video-card video-trigger" data-live="true" data-category="all" data-channel-id="${escapeHtml(channel.id)}" data-channel-title="${title}">
    <div class="thumbnail"><img src="${thumb}" alt="${title} channel" loading="lazy" /><span class="duration">CHANNEL</span><button class="hover-play" aria-label="Open channel"><svg><use href="#i-arrow"></use></svg></button></div>
    <div class="card-info"><div class="channel-avatar avatar-teal">@</div><div class="video-details"><h3>${title}</h3><p>Channel</p><p>${description}</p></div><button class="more-button" aria-label="More options"><svg><use href="#i-more"></use></svg></button></div>
  </article>`;
}

function renderLiveResults(items, title) {
  activeDataSource = 'live';
  feedTitle.textContent = title;
  videoGrid.innerHTML = items.map((item) => item.kind === 'channel' ? renderChannelCard(item) : renderVideoCard(item)).join('');
  emptyState.hidden = items.length > 0;
  bindVideoTriggers(videoGrid);
  bindMoreButtons(videoGrid);
  if (!items.length) showToast('YouTube returned no public results for that search.');
}

function renderLiveVideos(videos, title) {
  renderLiveResults(videos, title);
}

function restoreCuratedFeed() {
  activeDataSource = 'curated';
  videoGrid.innerHTML = curatedFeedMarkup;
  feedTitle.textContent = 'For your next rabbit hole';
  emptyState.hidden = true;
  bindVideoTriggers(videoGrid);
  bindMoreButtons(videoGrid);
}

async function runYouTubeSearch(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    restoreCuratedFeed();
    return;
  }
  const key = getApiKey(true);
  if (!key) {
    showToast('Live search was cancelled. Add an API key to search YouTube.');
    return;
  }
  const currentRequest = ++requestNumber;
  feedTitle.textContent = 'Searching YouTube…';
  emptyState.hidden = true;
  try {
    const items = await searchYouTube(cleanQuery);
    if (currentRequest !== requestNumber) return;
    renderLiveResults(items, `Results for “${cleanQuery}”`);
  } catch (error) {
    if (currentRequest !== requestNumber) return;
    showToast(error.message);
    feedTitle.textContent = `Results for “${cleanQuery}”`;
    emptyState.hidden = false;
  }
}

async function loadTrending() {
  const key = getApiKey(true);
  if (!key) {
    showToast('Add an API key to load live trending videos.');
    return;
  }
  const currentRequest = ++requestNumber;
  feedTitle.textContent = 'Loading what is trending…';
  emptyState.hidden = true;
  try {
    const response = await youtubeRequest('videos', {
      part: 'snippet,contentDetails,statistics',
      chart: 'mostPopular',
      regionCode: window.IDKTUBE_CONFIG?.regionCode || 'US',
      maxResults: '12',
    });
    if (currentRequest !== requestNumber) return;
    renderLiveVideos((response.items || []).map((item) => normalizeVideo(item)), 'Trending right now');
  } catch (error) {
    if (currentRequest !== requestNumber) return;
    showToast(error.message);
    feedTitle.textContent = 'Trending right now';
    emptyState.hidden = false;
  }
}

function openPlayer(trigger) {
  const id = trigger.dataset.videoId;
  if (!id) return;
  const title = trigger.dataset.videoTitle || 'Now playing';
  const channel = trigger.dataset.channel || 'YouTube';
  const duration = trigger.dataset.duration || '';
  playerTitle.textContent = title;
  playerMeta.textContent = `${channel}${duration ? ` · ${duration}` : ''}`;
  const params = new URLSearchParams({ autoplay: '1', rel: '0', modestbranding: '1', playsinline: '1' });
  if (window.location.origin && window.location.origin !== 'null') params.set('origin', window.location.origin);
  playerFrame.src = `https://www.youtube.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  $('.player-close').focus();
}

function closePlayer() {
  if (!modal.classList.contains('open')) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  playerFrame.src = '';
  document.body.style.overflow = '';
}

function bindVideoTriggers(parent = document) {
  $$('.video-trigger', parent).forEach((trigger) => {
    if (trigger.dataset.bound === 'true') return;
    trigger.dataset.bound = 'true';
    trigger.addEventListener('click', (event) => {
      if (event.target.closest('.more-button')) return;
      if (trigger.dataset.channelId) {
        loadChannelVideos(trigger.dataset.channelId, trigger.dataset.channelTitle || 'Channel');
      } else {
        openPlayer(trigger);
      }
    });
  });
}

function bindMoreButtons(parent = document) {
  $$('.more-button', parent).forEach((button) => {
    if (button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      showToast('More options are coming soon');
    });
  });
}

function filterCards(query = '', category = 'all') {
  const normalized = query.trim().toLowerCase();
  const cards = $$('.video-card', videoGrid);
  let visible = 0;
  cards.forEach((card) => {
    const matchesCategory = category === 'all' || activeDataSource === 'live' || card.dataset.category === category;
    const matchesQuery = !normalized || card.textContent.toLowerCase().includes(normalized);
    const shouldShow = matchesCategory && matchesQuery;
    card.hidden = !shouldShow;
    if (shouldShow) visible += 1;
  });
  emptyState.hidden = visible !== 0;
  if (normalized && activeDataSource === 'curated') feedTitle.textContent = `Results for “${query.trim()}”`;
  else if (!normalized && activeDataSource === 'curated') feedTitle.textContent = category === 'all' ? 'For your next rabbit hole' : `${category[0].toUpperCase()}${category.slice(1)} picks`;
}

$$('[data-close-player]').forEach((element) => element.addEventListener('click', closePlayer));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePlayer();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    $('#searchInput').focus();
  }
});

$('#searchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  runYouTubeSearch($('#searchInput').value);
});
$('#searchInput').addEventListener('input', (event) => {
  if (activeDataSource === 'curated') filterCards(event.target.value, $('.filter-button.active').dataset.filter);
});

$$('.filter-button').forEach((button) => {
  button.addEventListener('click', () => {
    $$('.filter-button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    filterCards($('#searchInput').value, button.dataset.filter);
  });
});

$$('.nav-item').forEach((item) => {
  item.addEventListener('click', (event) => {
    event.preventDefault();
    $$('.nav-item').forEach((navItem) => navItem.classList.remove('active'));
    item.classList.add('active');
    const view = item.dataset.view || 'Home';
    if (view === 'Trending') loadTrending();
    else if (view === 'Explore') {
      $('#searchInput').focus();
      showToast('Search YouTube above to explore live results');
    } else if (view === 'Home') restoreCuratedFeed();
    else showToast(`${view} needs YouTube sign-in to become personal`);
    $('#pageTitle').innerHTML = view === 'Home' ? 'Good evening, Hake<span>.</span>' : `${view}<span>.</span>`;
    closeSidebar();
  });
});

$$('[data-action="view-all"]').forEach((button) => button.addEventListener('click', () => {
  $('#feedTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Search YouTube to discover more');
}));

$('.save-player').addEventListener('click', (event) => {
  event.currentTarget.classList.toggle('saved');
  const saved = event.currentTarget.classList.contains('saved');
  event.currentTarget.innerHTML = `<svg><use href="#i-bookmark"></use></svg> ${saved ? 'Saved' : 'Save'}`;
  showToast(saved ? 'Added to your saved videos' : 'Removed from saved videos');
});

const sidebar = $('#sidebar');
const sidebarScrim = $('#sidebarScrim');
function closeSidebar() { sidebar.classList.remove('open'); sidebarScrim.classList.remove('open'); }
$('#menuButton').addEventListener('click', () => { sidebar.classList.add('open'); sidebarScrim.classList.add('open'); });
$('#sidebarClose').addEventListener('click', closeSidebar);
sidebarScrim.addEventListener('click', closeSidebar);

bindVideoTriggers(videoGrid);
bindMoreButtons(videoGrid);

// Make remote thumbnail failures degrade gracefully instead of showing broken-image icons.
document.addEventListener('error', (event) => {
  if (event.target?.tagName === 'IMG') {
    event.target.style.opacity = '0';
    event.target.parentElement.classList.add('image-fallback');
  }
}, true);
