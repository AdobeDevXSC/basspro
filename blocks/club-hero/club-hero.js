import { buildBlock, decorateBlock, loadBlock } from '../../scripts/aem.js';

let fragmentObserverInstalled = false;
let upgradeLock = false;

/**
 * @param {Element} section
 * @param {typeof buildBlock} buildBlockFn
 * @returns {HTMLElement|null}
 */
function tryUpgradeSection(section, buildBlockFn) {
  if (section.querySelector(':scope .club-hero')) return null;

  const wrapper = section.querySelector(':scope > .default-content-wrapper');
  if (!wrapper) return null;

  const kids = [...wrapper.children];
  if (kids.length < 6) return null;

  const [p0, p1, h2, ...rest] = kids;
  if (p0.tagName !== 'P' || p1.tagName !== 'P' || h2.tagName !== 'H2') return null;
  if (!p0.querySelector(':scope > picture') || !p1.querySelector(':scope > picture')) return null;

  const heading = h2.textContent.toLowerCase();
  if (!heading.includes('earn') || !heading.includes('club')) return null;

  const h3Index = rest.findIndex((el) => el.tagName === 'H3');
  if (h3Index < 0) return null;

  const ctaNodes = [h2, ...rest.slice(0, h3Index)];
  const panelNodes = rest.slice(h3Index);

  const blockHost = document.createElement('div');
  blockHost.append(
    buildBlockFn('club-hero', [
      [{ elems: [p0] }],
      [{ elems: [p1] }],
      [{ elems: ctaNodes }],
      [{ elems: panelNodes }],
    ]),
  );
  wrapper.replaceWith(blockHost);
  return blockHost.querySelector('.club-hero');
}

/**
 * Used by aem `decorateBlocks` (pass `buildBlock`) and by this module’s fragment helpers.
 * @param {ParentNode} root
 * @param {typeof buildBlock} buildBlockFn
 * @returns {HTMLElement[]}
 */
export function upgradeClubHeroFragments(root, buildBlockFn) {
  const out = [];
  if (!root?.querySelectorAll) return out;

  root.querySelectorAll('.section').forEach((section) => {
    const el = tryUpgradeSection(section, buildBlockFn);
    if (el) out.push(el);
  });
  return out;
}

/**
 * Flat fragment / doc-authored club sections → block DOM so this module + CSS load.
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export function buildClubHeroBlockFromFragment(root = document.body) {
  return upgradeClubHeroFragments(root, buildBlock);
}

async function finalizeNewClubHeroBlocks(blocks) {
  for (const blockEl of blocks) {
    decorateBlock(blockEl);
    // eslint-disable-next-line no-await-in-loop
    await loadBlock(blockEl);
  }
}

async function upgradeClubHeroFragmentsInTree(root = document.body) {
  if (upgradeLock) return;
  upgradeLock = true;
  try {
    const created = buildClubHeroBlockFromFragment(root);
    if (created.length) await finalizeNewClubHeroBlocks(created);
  } finally {
    upgradeLock = false;
  }
}

function installClubHeroFragmentObserver() {
  if (typeof window === 'undefined' || fragmentObserverInstalled) return;
  fragmentObserverInstalled = true;

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(async () => {
      pending = false;
      await upgradeClubHeroFragmentsInTree(document.body);
    });
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  schedule();
}

export default async function decorate(block) {
  installClubHeroFragmentObserver();
  await upgradeClubHeroFragmentsInTree(document.body);

  const rows = [...block.children];
  if (rows.length < 4) return;

  const [bgRow, cardRow, ctaRow, panelsRow] = rows;
  const bgCell = bgRow?.querySelector(':scope > div');
  const cardCell = cardRow?.querySelector(':scope > div');
  const ctaCell = ctaRow?.querySelector(':scope > div');
  const panelSource = panelsRow?.querySelector(':scope > div');

  if (!bgCell || !cardCell || !ctaCell || !panelSource) return;

  bgRow.classList.add('club-hero-bg');

  const content = document.createElement('div');
  content.classList.add('club-hero-content');

  cardCell.classList.add('club-hero-card');
  ctaCell.classList.add('club-hero-cta');

  content.append(cardCell);
  content.append(ctaCell);

  const panels = document.createElement('div');
  panels.classList.add('club-hero-panels');

  let currentPanel = null;
  [...panelSource.children].forEach((child) => {
    if (child.tagName === 'H3') {
      currentPanel = document.createElement('div');
      currentPanel.classList.add('club-hero-panel');
      panels.append(currentPanel);
    }
    if (currentPanel) {
      currentPanel.append(child);
    }
  });

  if (panels.children.length) {
    content.append(panels);
  }

  cardRow.remove();
  ctaRow.remove();
  panelsRow.remove();
  block.append(content);
}
