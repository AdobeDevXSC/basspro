export default function decorate(block) {
  const wrapper = block.closest('.product-cards-wrapper');

  const nav = document.createElement('div');
  nav.className = 'product-cards-nav';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'product-cards-nav-btn product-cards-nav-prev';
  prevBtn.setAttribute('aria-label', 'Previous');
  prevBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor"/></svg>';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'product-cards-nav-btn product-cards-nav-next';
  nextBtn.setAttribute('aria-label', 'Next');
  nextBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" fill="currentColor"/></svg>';

  nav.append(prevBtn, nextBtn);
  wrapper.append(nav);

  function getScrollAmount() {
    const card = block.querySelector(':scope > div');
    if (!card) return 300;
    return card.offsetWidth + 16;
  }

  prevBtn.addEventListener('click', () => {
    block.scrollBy({ left: -getScrollAmount(), behavior: 'smooth' });
  });

  nextBtn.addEventListener('click', () => {
    block.scrollBy({ left: getScrollAmount(), behavior: 'smooth' });
  });

  function updateButtons() {
    const { scrollLeft, scrollWidth, clientWidth } = block;
    prevBtn.disabled = scrollLeft <= 0;
    nextBtn.disabled = scrollLeft + clientWidth >= scrollWidth - 1;
  }

  block.addEventListener('scroll', updateButtons, { passive: true });
  updateButtons();
}
