import DA_SDK from 'https://da.live/nx/utils/sdk.js';

// Load config
const configResp = await fetch('/tools/products/config.json');
const config = await configResp.json();

const ACO_TENANT_ID = config.acoTenantId;
const CATALOG_VIEW_ID = config.catalogViewId;
const ACO_BASE_URL = `https://${config.region}-${config.environment}.api.commerce.adobe.com/${ACO_TENANT_ID}`;
const ACO_URL = `${ACO_BASE_URL}/graphql`;

const ACO_PRODUCTS_ENDPOINT = `${ACO_BASE_URL}/v1/catalog/products`;
const ACO_PRODUCTS_DELETE_ENDPOINT = `${ACO_BASE_URL}/v1/catalog/products/delete`;
const ACO_PRICES_ENDPOINT = `${ACO_BASE_URL}/v1/catalog/products/prices`;

const PAGE_SIZE = 25;
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRICE_BOOK = '';
const ALL_PRICE_BOOKS = [''];

const AUTH_ENDPOINT = 'https://hook.fusion.adobe.com/13cvqi354kot1fo54g7xwkr0079fj0js';

let accessToken = null;

async function requestAccessToken() {
  console.log('Requesting access token...');
  const response = await fetch(AUTH_ENDPOINT);

  if (!response.ok) {
    throw new Error(`Authentication failed: ${response.status}`);
  }

  const data = await response.json();
  console.log('Access token received, expires in:', data.expires_in, 'seconds');
  return data.access_token;
}

async function ensureAccessToken() {
  if (accessToken) return accessToken;
  accessToken = await requestAccessToken();
  return accessToken;
}

// State
const state = {
  products: [],
  filteredProducts: [],
  searchTerm: '',
  sortBy: 'featured',
  selectedCategory: 'all',
  selectedPriceBook: DEFAULT_PRICE_BOOK,
  currentPage: 1,
  totalCount: 0,
  isLoading: false,
  categories: [],
};

// Utility functions
function formatPrice(priceType) {
  if (!priceType?.amount) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: priceType.amount.currency || 'USD',
  }).format(priceType.amount.value);
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function showDiscount(price, globalPrice = null) {
  if (!price) return false;
  if (price.regular?.amount?.value !== price.final?.amount?.value) {
    return true;
  }
  if (globalPrice && globalPrice.final?.amount?.value !== price.final?.amount?.value) {
    return true;
  }
  return false;
}

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

// GraphQL query for product search
const PRODUCT_SEARCH_QUERY = `
  query Products($search: String!, $pageSize: Int!, $currentPage: Int!) {
    productSearch(
      phrase: $search
      filter: []
      sort: [{ attribute: "relevance", direction: DESC }]
      page_size: $pageSize
      current_page: $currentPage
    ) {
      total_count
      items {
        productView {
          sku
          name
          description
          shortDescription
          images {
            url
          }
          ... on SimpleProductView {
            attributes {
              label
              name
              value
            }
            price {
              regular {
                amount {
                  value
                  currency
                }
              }
              final {
                amount {
                  value
                  currency
                }
              }
              roles
            }
          }
        }
      }
    }
  }
`;

// Fetch products from ACO API
async function searchProducts(catalogId, locale, priceBook, searchTerm, pageSize, page) {
  try {
    const response = await fetch(ACO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ac-price-book-id': priceBook,
        'ac-source-locale': locale,
        'ac_environment_id': catalogId,
        'go-compute': '1',
      },
      body: JSON.stringify({
        query: PRODUCT_SEARCH_QUERY,
        variables: {
          search: searchTerm || '',
          pageSize,
          currentPage: page,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const searchResult = data?.data?.productSearch;

    if (!searchResult) {
      console.error('No search results in response:', data);
      return { products: [], totalCount: 0 };
    }

    // Transform API response to match expected format
    const products = searchResult.items.map((item) => {
      const product = item.productView;
      // Extract category from attributes if available
      const categoryAttr = product.attributes?.find((attr) => attr.name === 'category');

      return {
        sku: product.sku,
        name: product.name,
        description: product.description,
        shortDescription: product.shortDescription,
        category: categoryAttr?.value || '',
        images: product.images || [],
        price: product.price || { regular: null, final: null },
        attributes: product.attributes || [],
      };
    });

    return {
      products,
      totalCount: searchResult.total_count || 0,
    };
  } catch (error) {
    console.error('Error fetching products:', error);
    return { products: [], totalCount: 0 };
  }
}

// DOM Creation helpers
function createIcon(name) {
  const icons = {
    search: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    sort: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>`,
    grid: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></svg>`,
    list: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
    loader: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    plus: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
    close: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    key: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`,
    delete: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    clipboard: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`,
  };
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = icons[name] || '';
  return span;
}

// Modal state
const modalState = {
  isSubmitting: false,
  editingProduct: null, // Store the product being edited
};

// Modal functions
function openModal() {
  const modal = document.getElementById('add-product-modal');
  if (modal) {
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    // Reset form
    const form = modal.querySelector('form');
    if (form) form.reset();
    // Focus the first input
    const firstInput = modal.querySelector('input');
    if (firstInput) firstInput.focus();
  }
}

function closeModal() {
  const modal = document.getElementById('add-product-modal');
  if (modal) {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}

// Paste Product Modal functions
function openPasteModal() {
  const modal = document.getElementById('paste-product-modal');
  if (modal) {
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    // Reset form
    const textarea = modal.querySelector('#paste-html');
    if (textarea) textarea.value = '';
    textarea.focus();
  }
}

function closePasteModal() {
  const modal = document.getElementById('paste-product-modal');
  if (modal) {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
  }
}

function parseHtmlToProduct(html) {
  // Create a temporary DOM element to parse the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Try to extract product data from common patterns
  const extracted = {
    sku: '',
    name: '',
    description: '',
    price: '',
    image: '',
  };

  // ===== EXTRACT SKU =====
  // Try data attributes first
  const skuEl = doc.querySelector('[data-sku], [data-product-sku], [data-product-id], [data-item-id]');
  if (skuEl) {
    extracted.sku = skuEl.dataset.sku || skuEl.dataset.productSku || skuEl.dataset.productId || skuEl.dataset.itemId;
  }

  // Try to extract SKU/ID from URLs (common pattern like /product/12345 or /p/name/12345)
  if (!extracted.sku) {
    const links = doc.querySelectorAll('a[href]');
    for (const link of links) {
      const href = link.getAttribute('href') || '';
      // Match patterns like /p/product-name/0001111097872 or /product/12345
      const skuMatch = href.match(/\/(?:p|product|item|products)\/[^/]*\/(\d{6,})|\/(\d{6,})(?:\?|$)/);
      if (skuMatch) {
        extracted.sku = skuMatch[1] || skuMatch[2];
        break;
      }
    }
  }

  // Try extracting from image URLs
  if (!extracted.sku) {
    const img = doc.querySelector('img[src]');
    if (img) {
      const src = img.getAttribute('src') || '';
      const skuMatch = src.match(/\/(\d{10,})/);
      if (skuMatch) {
        extracted.sku = skuMatch[1];
      }
    }
  }

  // Fallback to class-based selectors
  if (!extracted.sku) {
    const skuTextEl = doc.querySelector('.sku, .product-sku, #sku, [class*="sku"]');
    if (skuTextEl) {
      extracted.sku = skuTextEl.textContent.trim();
    }
  }

  // ===== EXTRACT NAME =====
  // Try aria-label on main container (common in modern e-commerce)
  const containerWithLabel = doc.querySelector('[aria-label]');
  if (containerWithLabel) {
    const label = containerWithLabel.getAttribute('aria-label');
    // Check if it looks like a product name (not a generic label)
    if (label && label.length > 10 && !label.toLowerCase().includes('sign in') && !label.toLowerCase().includes('add to')) {
      extracted.name = label;
    }
  }

  // Try data-testid patterns (common in React apps)
  if (!extracted.name) {
    const testIdEl = doc.querySelector('[data-testid="product-title"], [data-testid="product-name"], [data-testid="cart-page-item-description"], [data-testid*="description"], [data-testid*="title"]');
    if (testIdEl) {
      extracted.name = testIdEl.textContent.trim();
    }
  }

  // Try heading elements and common classes
  if (!extracted.name) {
    const nameEl = doc.querySelector('h1, h2, h3, .product-name, .product-title, [data-product-name], .title, .name');
    if (nameEl) {
      extracted.name = nameEl.dataset.productName || nameEl.textContent.trim();
    }
  }

  // ===== EXTRACT DESCRIPTION =====
  // Try data-testid for sizing/details
  const sizingEl = doc.querySelector('[data-testid="product-item-sizing"], [data-testid*="sizing"], [data-testid*="size"]');
  if (sizingEl) {
    extracted.description = sizingEl.textContent.trim();
  }

  // Try common description selectors
  if (!extracted.description) {
    const descEl = doc.querySelector('.description, .product-description, [data-description], p.desc, .details, [class*="description"]');
    if (descEl) {
      extracted.description = descEl.dataset.description || descEl.textContent.trim();
    }
  }

  // If we have a name, use sizing as additional info
  if (extracted.name && sizingEl && !extracted.description) {
    extracted.description = sizingEl.textContent.trim();
  }

  // ===== EXTRACT PRICE =====
  // Try <data> element with value attribute (semantic price markup)
  const dataEl = doc.querySelector('data[value], data[typeof="Price"]');
  if (dataEl) {
    const value = dataEl.getAttribute('value');
    if (value) {
      extracted.price = value;
    }
  }

  // Try data-testid for price
  if (!extracted.price) {
    const priceTestId = doc.querySelector('[data-testid*="price"], [data-testid*="cost"]');
    if (priceTestId) {
      const priceText = priceTestId.textContent.trim();
      const priceMatch = priceText.match(/\$?([\d,.]+)/);
      if (priceMatch) {
        extracted.price = priceMatch[1].replace(/,/g, '');
      }
    }
  }

  // Try common price classes
  if (!extracted.price) {
    const priceEl = doc.querySelector('.price, .product-price, [data-price], .cost, .amount, [class*="Price"], [class*="price"]');
    if (priceEl) {
      const priceText = priceEl.dataset.price || priceEl.getAttribute('value') || priceEl.textContent.trim();
      const priceMatch = priceText.match(/\$?([\d,.]+)/);
      if (priceMatch) {
        extracted.price = priceMatch[1].replace(/,/g, '');
      }
    }
  }

  // ===== EXTRACT IMAGE =====
  // Try product image with data-testid
  const productImg = doc.querySelector('[data-testid="product-image"] img, [data-testid="product-image-loaded"], .product-image img');
  if (productImg) {
    extracted.image = productImg.getAttribute('src') || productImg.dataset.src || '';
  }

  // Try any image
  if (!extracted.image) {
    const imgEl = doc.querySelector('img[src]');
    if (imgEl) {
      extracted.image = imgEl.getAttribute('src') || imgEl.dataset.src || imgEl.dataset.image || '';
    }
  }

  // Clean up extracted data
  if (extracted.name) {
    // Remove extra whitespace
    extracted.name = extracted.name.replace(/\s+/g, ' ').trim();
  }

  console.log('Parsed HTML - extracted data:', extracted);

  return extracted;
}

function handleParseHtml() {
  const modal = document.getElementById('paste-product-modal');
  const textarea = modal.querySelector('#paste-html');
  const html = textarea.value.trim();

  if (!html) {
    alert('Please paste some HTML first');
    return;
  }

  const extracted = parseHtmlToProduct(html);

  // Populate the form fields
  const skuInput = modal.querySelector('#paste-sku');
  const nameInput = modal.querySelector('#paste-name');
  const descInput = modal.querySelector('#paste-description');
  const priceInput = modal.querySelector('#paste-price');
  const imageInput = modal.querySelector('#paste-image');

  if (skuInput) skuInput.value = extracted.sku;
  if (nameInput) nameInput.value = extracted.name;
  if (descInput) descInput.value = extracted.description;
  if (priceInput) priceInput.value = extracted.price;
  if (imageInput) imageInput.value = extracted.image;

  console.log('Parsed product data:', extracted);
}

async function handlePasteSubmit(form) {
  if (modalState.isSubmitting) return;

  // Get visibility checkboxes
  const visibilityCheckboxes = form.querySelectorAll('input[name="paste-visible-in"]:checked');
  const visibleIn = Array.from(visibilityCheckboxes).map((cb) => cb.value);

  const formData = {
    sku: form.querySelector('#paste-sku')?.value.trim() || '',
    name: form.querySelector('#paste-name')?.value.trim() || '',
    description: form.querySelector('#paste-description')?.value.trim() || '',
    price: form.querySelector('#paste-price')?.value || '0',
    imageUrl: form.querySelector('#paste-image')?.value.trim() || '',
    visibleIn,
    // Attributes
    attributes: extractDynamicListItems(form, 'paste-product-attributes', ['code', 'type', 'value']),
    // Meta tags
    metaTitle: form.querySelector('#paste-meta-title')?.value.trim() || '',
    metaDescription: form.querySelector('#paste-meta-description')?.value.trim() || '',
    metaKeywords: form.querySelector('#paste-meta-keywords')?.value.trim() || '',
  };

  if (!formData.sku || !formData.name) {
    alert('SKU and Product Name are required');
    return;
  }

  console.log('Submitting pasted product:', formData);

  // Build payloads
  const productPayload = buildProductPayload({
    ...formData,
    shortDescription: formData.description,
    images: formData.imageUrl ? [{ url: formData.imageUrl, label: formData.name, roles: 'THUMBNAIL, BASE, SMALL' }] : [],
    attributes: formData.attributes,
    metaTitle: formData.metaTitle,
    metaDescription: formData.metaDescription,
    metaKeywords: formData.metaKeywords,
  });
  const pricePayload = buildPricePayload(formData.sku, formData.price, DEFAULT_PRICE_BOOK);

  console.log('Product Payload:', JSON.stringify(productPayload, null, 2));
  console.log('Price Payload:', JSON.stringify(pricePayload, null, 2));

  // Get submit button and update state
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.textContent : 'Add Product';

  try {
    modalState.isSubmitting = true;

    // Update button state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding...';
    }

    // Ensure we have an access token
    await ensureAccessToken();

    if (!accessToken) {
      throw new Error('No access token available. Please enter a token first.');
    }

    // Submit to ACO API
    const result = await submitProductToACO(productPayload, pricePayload);
    console.log('Product created successfully:', result);

    closePasteModal();
    showSuccessMessage(`Product "${formData.name}" added successfully!`);

    // Refresh product list
    state.currentPage = 1;
    await loadProducts();
  } catch (error) {
    console.error('Failed to create product:', error);
    alert(`Failed to create product: ${error.message}`);
  } finally {
    modalState.isSubmitting = false;
    // Restore button state
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText;
    }
  }
}

async function handleAuthenticate(btn) {
  const btnText = btn.querySelector('span');
  const origText = btnText.textContent;
  btnText.textContent = 'Authenticating...';
  btn.disabled = true;

  try {
    accessToken = await requestAccessToken();
    btnText.textContent = 'Authenticated';
    await loadProducts();
  } catch (error) {
    console.error('Authentication failed:', error);
    btnText.textContent = origText;
    alert('Authentication failed. Please try again.');
  } finally {
    btn.disabled = false;
  }
}

// Edit Modal functions
function openEditModal(product) {
  modalState.editingProduct = product;
  const modal = document.getElementById('edit-product-modal');
  if (modal) {
    // Populate form with product data
    const form = modal.querySelector('form');
    if (form) {
      form.querySelector('#edit-product-name').value = product.name || '';
      form.querySelector('#edit-product-sku').value = product.sku || '';
      form.querySelector('#edit-product-price').value = product.price?.final?.amount?.value || '';
      form.querySelector('#edit-product-category').value = product.category || '';
      form.querySelector('#edit-product-short-description').value = product.shortDescription || '';
      form.querySelector('#edit-product-image').value = product.images?.[0]?.url || '';
      form.querySelector('#edit-product-description').value = product.description || '';

      // Populate attributes
      const attributesContainer = form.querySelector('#edit-product-attributes-list');
      if (attributesContainer) {
        // Clear existing attribute rows
        attributesContainer.innerHTML = '';

        // Add rows for each attribute
        if (product.attributes && product.attributes.length > 0) {
          product.attributes.forEach((attr) => {
            const itemRow = createDynamicListItem('edit-product-attributes', [
              { name: 'code', placeholder: 'Attribute code (e.g., brand)', type: 'text' },
              {
                name: 'type',
                placeholder: 'Type',
                type: 'select',
                options: [
                  { value: 'STRING', label: 'String' },
                  { value: 'NUMBER', label: 'Number' },
                  { value: 'BOOLEAN', label: 'Boolean' },
                ],
              },
              { name: 'value', placeholder: 'Value', type: 'text' },
            ]);

            // Set values
            const codeInput = itemRow.querySelector('input[name="edit-product-attributes-code"]');
            const typeSelect = itemRow.querySelector('select[name="edit-product-attributes-type"]');
            const valueInput = itemRow.querySelector('input[name="edit-product-attributes-value"]');

            if (codeInput) codeInput.value = attr.code || attr.name || '';
            if (typeSelect) typeSelect.value = attr.type || 'STRING';
            if (valueInput) valueInput.value = attr.value || (attr.values && attr.values[0]) || '';

            attributesContainer.appendChild(itemRow);
          });
        }
      }

      // Populate meta tags
      if (product.metaTags) {
        const metaTitleInput = form.querySelector('#edit-product-meta-title');
        const metaDescInput = form.querySelector('#edit-product-meta-description');
        const metaKeywordsInput = form.querySelector('#edit-product-meta-keywords');

        if (metaTitleInput) metaTitleInput.value = product.metaTags.title || '';
        if (metaDescInput) metaDescInput.value = product.metaTags.description || '';
        if (metaKeywordsInput && product.metaTags.keywords) {
          // Convert keywords array back to comma-separated string
          metaKeywordsInput.value = Array.isArray(product.metaTags.keywords)
            ? product.metaTags.keywords.join(', ')
            : product.metaTags.keywords;
        }
      }
    }

    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
}

function closeEditModal() {
  const modal = document.getElementById('edit-product-modal');
  if (modal) {
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    modalState.editingProduct = null;
  }
}

/**
 * Build the product update payload for ACO PATCH request
 */
function buildProductUpdatePayload(sku, formData) {
  const payload = {
    sku,
    source: {
      locale: DEFAULT_LOCALE,
    },
  };

  // Only include fields that have values
  if (formData.name) payload.name = formData.name;
  if (formData.description) payload.description = formData.description;
  if (formData.shortDescription) payload.shortDescription = formData.shortDescription;

  // Handle image update
  // Valid roles: BASE, SMALL, THUMBNAIL, SWATCH
  if (formData.imageUrl) {
    payload.images = [{
      url: formData.imageUrl,
      label: formData.name || '',
      roles: ['BASE', 'THUMBNAIL', 'SMALL'],
    }];
  }

  // Handle category as attribute with proper ACO format
  if (formData.category) {
    payload.attributes = payload.attributes || [];
    payload.attributes.push({
      code: 'category',
      type: 'STRING',
      values: [formData.category],
    });
  }

  // Handle additional attributes if provided
  if (formData.attributes && formData.attributes.length > 0) {
    payload.attributes = payload.attributes || [];
    formData.attributes.forEach((attr) => {
      payload.attributes.push({
        code: attr.code,
        type: attr.type || 'STRING',
        values: Array.isArray(attr.values) ? attr.values : [attr.value || attr.values],
      });
    });
  }

  // Handle meta tags
  if (formData.metaTitle || formData.metaDescription || formData.metaKeywords) {
    payload.metaTags = {};
    if (formData.metaTitle) payload.metaTags.title = formData.metaTitle;
    if (formData.metaDescription) payload.metaTags.description = formData.metaDescription;
    if (formData.metaKeywords) {
      // Split comma-separated keywords into array
      payload.metaTags.keywords = formData.metaKeywords.split(',').map((k) => k.trim()).filter((k) => k);
    }
  }

  return payload;
}

/**
 * Update product via ACO PATCH API
 * PATCH https://na1-sandbox.api.commerce.adobe.com/{{tenantId}}
 */
async function updateProductInACO(productPayload) {
  // Ensure we have an access token
  await ensureAccessToken();

  if (!accessToken) {
    throw new Error('No access token available. Please ensure you are authenticated.');
  }

  console.log('Using access token for update:', accessToken.substring(0, 50) + '...');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  console.log('Request headers:', headers);

  try {
    console.log('Updating product in ACO...', productPayload);
    console.log('PATCH URL:', ACO_PRODUCTS_ENDPOINT);

    const response = await fetch(ACO_PRODUCTS_ENDPOINT, {
      method: 'PATCH',
      headers,
      body: JSON.stringify([productPayload]), // API expects an array
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Product update failed:', errorText);
      throw new Error(`Failed to update product: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Product update response:', result);

    return result;
  } catch (error) {
    console.error('Error updating product in ACO:', error);
    throw error;
  }
}

/**
 * Delete product via ACO API
 * POST https://na1-sandbox.api.commerce.adobe.com/{{tenantId}}/v1/catalog/products/delete
 */
async function deleteProductFromACO(sku) {
  // Ensure we have an access token
  await ensureAccessToken();

  if (!accessToken) {
    throw new Error('No access token available. Please ensure you are authenticated.');
  }

  console.log('=== DELETE REQUEST ===');
  console.log('User-provided token:', userProvidedToken);
  console.log('Using access token for delete:', accessToken.substring(0, 50) + '...');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  const deletePayload = [
    {
      sku,
      source: {
        locale: DEFAULT_LOCALE,
      },
    },
  ];

  try {
    console.log('Deleting product from ACO...', deletePayload);
    console.log('DELETE URL:', ACO_PRODUCTS_DELETE_ENDPOINT);

    const response = await fetch(ACO_PRODUCTS_DELETE_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(deletePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Product delete failed:', errorText);
      throw new Error(`Failed to delete product: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('Product delete response:', result);

    return result;
  } catch (error) {
    console.error('Error deleting product from ACO:', error);
    throw error;
  }
}

/**
 * Handle delete button click on product card
 */
async function handleProductDelete(product, cardElement) {
  const confirmed = confirm(`Are you sure you want to delete "${product.name}"?\n\nSKU: ${product.sku}\n\nThis action cannot be undone.`);

  if (!confirmed) {
    return;
  }

  try {
    // Add loading state to card
    cardElement.classList.add('plp-card-deleting');

    await deleteProductFromACO(product.sku);

    // Remove card from DOM with animation
    cardElement.style.opacity = '0';
    cardElement.style.transform = 'scale(0.8)';
    setTimeout(() => {
      cardElement.remove();
      // Update total count
      state.totalProducts = Math.max(0, state.totalProducts - 1);
      const resultsCount = document.querySelector('.plp-results-count');
      if (resultsCount) {
        resultsCount.textContent = `${state.totalProducts} products`;
      }
    }, 300);

    console.log(`Product "${product.name}" deleted successfully`);
  } catch (error) {
    cardElement.classList.remove('plp-card-deleting');
    alert(`Failed to delete product: ${error.message}`);
  }
}

/**
 * Handle edit form submission
 */
async function handleProductUpdate(form) {
  if (modalState.isSubmitting || !modalState.editingProduct) return;

  // Get form values
  const formData = {
    name: form.querySelector('#edit-product-name').value.trim(),
    price: form.querySelector('#edit-product-price').value,
    category: form.querySelector('#edit-product-category').value.trim(),
    shortDescription: form.querySelector('#edit-product-short-description').value.trim(),
    description: form.querySelector('#edit-product-description').value.trim(),
    imageUrl: form.querySelector('#edit-product-image').value.trim(),
    attributes: extractDynamicListItems(form, 'edit-product-attributes', ['code', 'type', 'value']),
    // Meta tags
    metaTitle: form.querySelector('#edit-product-meta-title')?.value.trim() || '',
    metaDescription: form.querySelector('#edit-product-meta-description')?.value.trim() || '',
    metaKeywords: form.querySelector('#edit-product-meta-keywords')?.value.trim() || '',
  };

  const sku = modalState.editingProduct.sku;

  // Build update payload
  const productPayload = buildProductUpdatePayload(sku, formData);

  console.log('Product Update Payload:', productPayload);

  // Update UI state
  modalState.isSubmitting = true;
  updateEditSubmitButton(true);

  try {
    // Submit update to ACO
    await updateProductInACO(productPayload);

    // Success - close modal and refresh products
    closeEditModal();
    showSuccessMessage(`Product "${formData.name || sku}" updated successfully!`);

    // Refresh product list (note: changes may take time to propagate)
    state.currentPage = 1;
    await loadProducts();
  } catch (error) {
    console.error('Failed to update product:', error);
    showFormError(`Failed to update product: ${error.message}`);
  } finally {
    modalState.isSubmitting = false;
    updateEditSubmitButton(false);
  }
}

function updateEditSubmitButton(isLoading) {
  const submitBtn = document.querySelector('#edit-product-modal .plp-modal-submit');
  if (submitBtn) {
    submitBtn.disabled = isLoading;
    const span = submitBtn.querySelector('span');
    if (span) {
      span.textContent = isLoading ? 'Updating...' : 'Update Product';
    }
    if (isLoading) {
      submitBtn.classList.add('is-loading');
    } else {
      submitBtn.classList.remove('is-loading');
    }
  }
}

function createPasteModal() {
  const modal = document.createElement('div');
  modal.id = 'paste-product-modal';
  modal.className = 'plp-modal';

  const overlay = document.createElement('div');
  overlay.className = 'plp-modal-overlay';
  overlay.addEventListener('click', closePasteModal);

  const dialog = document.createElement('div');
  dialog.className = 'plp-modal-dialog plp-modal-dialog-xlarge';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'paste-modal-title');

  // Header
  const header = document.createElement('div');
  header.className = 'plp-modal-header';

  const title = document.createElement('h2');
  title.id = 'paste-modal-title';
  title.className = 'plp-modal-title';
  title.textContent = 'Paste a Product';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'plp-modal-close';
  closeBtn.setAttribute('aria-label', 'Close modal');
  closeBtn.appendChild(createIcon('close'));
  closeBtn.addEventListener('click', closePasteModal);

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'plp-modal-body';

  // Form
  const form = document.createElement('form');
  form.className = 'plp-modal-form';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handlePasteSubmit(form);
  });

  // Two-column layout container
  const columnsContainer = document.createElement('div');
  columnsContainer.className = 'plp-paste-columns';

  // Left column - HTML textarea
  const leftColumn = document.createElement('div');
  leftColumn.className = 'plp-paste-column plp-paste-column-left';

  const pasteGroup = document.createElement('div');
  pasteGroup.className = 'plp-form-group';

  const pasteLabel = document.createElement('label');
  pasteLabel.className = 'plp-form-label';
  pasteLabel.setAttribute('for', 'paste-html');
  pasteLabel.textContent = 'Paste HTML';

  const pasteHelp = document.createElement('p');
  pasteHelp.className = 'plp-form-help';
  pasteHelp.textContent = 'Paste the HTML content for the product below.';

  const pasteTextarea = document.createElement('textarea');
  pasteTextarea.id = 'paste-html';
  pasteTextarea.className = 'plp-form-input plp-form-textarea plp-form-textarea-large';
  pasteTextarea.placeholder = '<div class="product">\n  <h1>Product Name</h1>\n  <span class="sku">SKU-123</span>\n  <p class="description">...</p>\n  <span class="price">$99.99</span>\n  <img src="https://..." />\n</div>';
  pasteTextarea.rows = 18;

  pasteGroup.appendChild(pasteLabel);
  pasteGroup.appendChild(pasteHelp);
  pasteGroup.appendChild(pasteTextarea);
  leftColumn.appendChild(pasteGroup);

  // Parse button
  const parseBtn = document.createElement('button');
  parseBtn.type = 'button';
  parseBtn.className = 'plp-button plp-button-secondary plp-parse-btn';
  parseBtn.textContent = 'Parse HTML →';
  parseBtn.addEventListener('click', handleParseHtml);
  leftColumn.appendChild(parseBtn);

  // Right column - Form inputs
  const rightColumn = document.createElement('div');
  rightColumn.className = 'plp-paste-column plp-paste-column-right';

  const fieldsTitle = document.createElement('h3');
  fieldsTitle.className = 'plp-form-section-title';
  fieldsTitle.textContent = 'Product Details';
  rightColumn.appendChild(fieldsTitle);

  // SKU field
  const skuGroup = document.createElement('div');
  skuGroup.className = 'plp-form-group';
  const skuLabel = document.createElement('label');
  skuLabel.className = 'plp-form-label';
  skuLabel.setAttribute('for', 'paste-sku');
  skuLabel.textContent = 'SKU *';
  const skuInput = document.createElement('input');
  skuInput.type = 'text';
  skuInput.id = 'paste-sku';
  skuInput.className = 'plp-form-input';
  skuInput.placeholder = 'e.g., PROD-001';
  skuInput.required = true;
  skuGroup.appendChild(skuLabel);
  skuGroup.appendChild(skuInput);
  rightColumn.appendChild(skuGroup);

  // Product Name field
  const nameGroup = document.createElement('div');
  nameGroup.className = 'plp-form-group';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'plp-form-label';
  nameLabel.setAttribute('for', 'paste-name');
  nameLabel.textContent = 'Product Name *';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'paste-name';
  nameInput.className = 'plp-form-input';
  nameInput.placeholder = 'Enter product name';
  nameInput.required = true;
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);
  rightColumn.appendChild(nameGroup);

  // Description field
  const descGroup = document.createElement('div');
  descGroup.className = 'plp-form-group';
  const descLabel = document.createElement('label');
  descLabel.className = 'plp-form-label';
  descLabel.setAttribute('for', 'paste-description');
  descLabel.textContent = 'Description';
  const descTextarea = document.createElement('textarea');
  descTextarea.id = 'paste-description';
  descTextarea.className = 'plp-form-input plp-form-textarea';
  descTextarea.placeholder = 'Product description';
  descTextarea.rows = 4;
  descGroup.appendChild(descLabel);
  descGroup.appendChild(descTextarea);
  rightColumn.appendChild(descGroup);

  // Price field
  const priceGroup = document.createElement('div');
  priceGroup.className = 'plp-form-group';
  const priceLabel = document.createElement('label');
  priceLabel.className = 'plp-form-label';
  priceLabel.setAttribute('for', 'paste-price');
  priceLabel.textContent = 'Price (USD)';
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.id = 'paste-price';
  priceInput.className = 'plp-form-input';
  priceInput.placeholder = '0.00';
  priceInput.step = '0.01';
  priceGroup.appendChild(priceLabel);
  priceGroup.appendChild(priceInput);
  rightColumn.appendChild(priceGroup);

  // Image URL field
  const imageGroup = document.createElement('div');
  imageGroup.className = 'plp-form-group';
  const imageLabel = document.createElement('label');
  imageLabel.className = 'plp-form-label';
  imageLabel.setAttribute('for', 'paste-image');
  imageLabel.textContent = 'Image URL';
  const imageInput = document.createElement('input');
  imageInput.type = 'url';
  imageInput.id = 'paste-image';
  imageInput.className = 'plp-form-input';
  imageInput.placeholder = 'https://example.com/image.jpg';
  imageGroup.appendChild(imageLabel);
  imageGroup.appendChild(imageInput);
  rightColumn.appendChild(imageGroup);

  // Visibility checkboxes
  const visibilityGroup = document.createElement('div');
  visibilityGroup.className = 'plp-form-group';
  const visibilityLabel = document.createElement('label');
  visibilityLabel.className = 'plp-form-label';
  visibilityLabel.textContent = 'Visibility';
  visibilityGroup.appendChild(visibilityLabel);

  const checkboxContainer = document.createElement('div');
  checkboxContainer.className = 'plp-checkbox-group';

  // Catalog checkbox
  const catalogLabel = document.createElement('label');
  catalogLabel.className = 'plp-checkbox-label';
  const catalogCheckbox = document.createElement('input');
  catalogCheckbox.type = 'checkbox';
  catalogCheckbox.name = 'paste-visible-in';
  catalogCheckbox.id = 'paste-visible-catalog';
  catalogCheckbox.value = 'CATALOG';
  catalogCheckbox.checked = true;
  catalogLabel.appendChild(catalogCheckbox);
  catalogLabel.appendChild(document.createTextNode(' Catalog'));
  checkboxContainer.appendChild(catalogLabel);

  // Search checkbox
  const searchLabel = document.createElement('label');
  searchLabel.className = 'plp-checkbox-label';
  const searchCheckbox = document.createElement('input');
  searchCheckbox.type = 'checkbox';
  searchCheckbox.name = 'paste-visible-in';
  searchCheckbox.id = 'paste-visible-search';
  searchCheckbox.value = 'SEARCH';
  searchCheckbox.checked = true;
  searchLabel.appendChild(searchCheckbox);
  searchLabel.appendChild(document.createTextNode(' Search'));
  checkboxContainer.appendChild(searchLabel);

  visibilityGroup.appendChild(checkboxContainer);
  rightColumn.appendChild(visibilityGroup);

  // Attributes section
  const attributesSection = createFormSection('Attributes');
  const attributesList = createDynamicListSection('paste-product-attributes', '', [
    { name: 'code', placeholder: 'Attribute code (e.g., brand)', type: 'text' },
    {
      name: 'type',
      placeholder: 'Type',
      type: 'select',
      options: [
        { value: 'STRING', label: 'String' },
        { value: 'NUMBER', label: 'Number' },
        { value: 'BOOLEAN', label: 'Boolean' },
      ],
    },
    { name: 'value', placeholder: 'Value', type: 'text' },
  ], 'Add Attribute');
  attributesSection.appendChild(attributesList);
  rightColumn.appendChild(attributesSection);

  // Meta Tags section
  const metaTagsSection = createFormSection('SEO / Meta Tags');
  const metaTitleGroup = createFormGroup('paste-meta-title', 'Meta Title', 'text', 'SEO title for search engines');
  const metaDescGroup = createFormGroup('paste-meta-description', 'Meta Description', 'text', 'SEO description for search engines');
  const metaKeywordsGroup = createFormGroup('paste-meta-keywords', 'Meta Keywords', 'text', 'keyword1, keyword2, keyword3 (comma separated)');
  metaTagsSection.appendChild(metaTitleGroup);
  metaTagsSection.appendChild(metaDescGroup);
  metaTagsSection.appendChild(metaKeywordsGroup);
  rightColumn.appendChild(metaTagsSection);

  columnsContainer.appendChild(leftColumn);
  columnsContainer.appendChild(rightColumn);
  form.appendChild(columnsContainer);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'plp-modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'plp-button plp-button-secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closePasteModal);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'plp-button';
  submitBtn.textContent = 'Add Product';

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);

  form.appendChild(footer);
  body.appendChild(form);

  dialog.appendChild(header);
  dialog.appendChild(body);

  modal.appendChild(overlay);
  modal.appendChild(dialog);

  return modal;
}


function createEditModal() {
  const modal = document.createElement('div');
  modal.id = 'edit-product-modal';
  modal.className = 'plp-modal';

  const overlay = document.createElement('div');
  overlay.className = 'plp-modal-overlay';
  overlay.addEventListener('click', closeEditModal);

  const dialog = document.createElement('div');
  dialog.className = 'plp-modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'edit-modal-title');

  // Header
  const header = document.createElement('div');
  header.className = 'plp-modal-header';

  const title = document.createElement('h2');
  title.id = 'edit-modal-title';
  title.className = 'plp-modal-title';
  title.textContent = 'Edit Product';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'plp-modal-close';
  closeBtn.setAttribute('aria-label', 'Close modal');
  closeBtn.appendChild(createIcon('close'));
  closeBtn.addEventListener('click', closeEditModal);

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'plp-modal-body';

  // Form
  const form = document.createElement('form');
  form.className = 'plp-modal-form';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleProductUpdate(form);
  });

  // SKU field (readonly)
  const skuGroup = document.createElement('div');
  skuGroup.className = 'plp-form-group';
  const skuLabel = document.createElement('label');
  skuLabel.htmlFor = 'edit-product-sku';
  skuLabel.textContent = 'SKU';
  const skuInput = document.createElement('input');
  skuInput.type = 'text';
  skuInput.id = 'edit-product-sku';
  skuInput.className = 'plp-form-input';
  skuInput.readOnly = true;
  skuInput.style.backgroundColor = 'var(--spectrum-gray-100)';
  skuGroup.appendChild(skuLabel);
  skuGroup.appendChild(skuInput);

  // Product Name field
  const nameGroup = createFormGroup('edit-product-name', 'Product Name', 'text', 'Enter product name');

  // Price field
  const priceGroup = createFormGroup('edit-product-price', 'Price (USD)', 'number', '0.00');

  // Category field
  const categoryGroup = createFormGroup('edit-product-category', 'Category', 'text', 'e.g., Electronics');

  // Short Description field
  const shortDescGroup = createFormGroup('edit-product-short-description', 'Short Description', 'text', 'Brief product summary');

  // Image URL field
  const imageGroup = createFormGroup('edit-product-image', 'Image URL', 'url', 'https://example.com/image.jpg');

  // Description field (textarea)
  const descGroup = document.createElement('div');
  descGroup.className = 'plp-form-group';
  const descLabel = document.createElement('label');
  descLabel.htmlFor = 'edit-product-description';
  descLabel.textContent = 'Description';
  const descTextarea = document.createElement('textarea');
  descTextarea.id = 'edit-product-description';
  descTextarea.className = 'plp-form-textarea';
  descTextarea.placeholder = 'Enter detailed product description';
  descTextarea.rows = 4;
  descGroup.appendChild(descLabel);
  descGroup.appendChild(descTextarea);

  // Attributes section
  const attributesSection = createFormSection('Attributes');
  const attributesList = createDynamicListSection('edit-product-attributes', '', [
    { name: 'code', placeholder: 'Attribute code (e.g., brand)', type: 'text' },
    {
      name: 'type',
      placeholder: 'Type',
      type: 'select',
      options: [
        { value: 'STRING', label: 'String' },
        { value: 'NUMBER', label: 'Number' },
        { value: 'BOOLEAN', label: 'Boolean' },
      ],
    },
    { name: 'value', placeholder: 'Value', type: 'text' },
  ], 'Add Attribute');
  attributesSection.appendChild(attributesList);

  // Meta Tags section
  const metaTagsSection = createFormSection('SEO / Meta Tags');
  const metaTitleGroup = createFormGroup('edit-product-meta-title', 'Meta Title', 'text', 'SEO title for search engines');
  const metaDescGroup = createFormGroup('edit-product-meta-description', 'Meta Description', 'text', 'SEO description for search engines');
  const metaKeywordsGroup = createFormGroup('edit-product-meta-keywords', 'Meta Keywords', 'text', 'keyword1, keyword2, keyword3 (comma separated)');
  metaTagsSection.appendChild(metaTitleGroup);
  metaTagsSection.appendChild(metaDescGroup);
  metaTagsSection.appendChild(metaKeywordsGroup);

  form.appendChild(skuGroup);
  form.appendChild(nameGroup);
  form.appendChild(priceGroup);
  form.appendChild(categoryGroup);
  form.appendChild(shortDescGroup);
  form.appendChild(imageGroup);
  form.appendChild(descGroup);
  form.appendChild(attributesSection);
  form.appendChild(metaTagsSection);

  body.appendChild(form);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'plp-modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'plp-button plp-modal-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeEditModal);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'plp-button plp-modal-submit';
  const submitBtnText = document.createElement('span');
  submitBtnText.textContent = 'Update Product';
  submitBtn.appendChild(submitBtnText);
  submitBtn.addEventListener('click', () => {
    form.dispatchEvent(new Event('submit'));
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);

  modal.appendChild(overlay);
  modal.appendChild(dialog);

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      closeEditModal();
    }
  });

  return modal;
}

/**
 * Build the product payload for ACO Catalog Ingestion API
 * Based on @adobe-commerce/aco-ts-sdk FeedProduct type
 * See: https://github.com/adobe-commerce/aco-sample-catalog-data-ingestion
 */
function buildProductPayload(formData) {
  // Generate slug from name if not provided
  const slug = formData.slug
    || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const payload = {
    // Required fields
    sku: formData.sku,
    source: {
      locale: DEFAULT_LOCALE,
    },
    name: formData.name,
    slug,
    status: formData.status || 'ENABLED',

    // Optional fields
    description: formData.description || '',
    shortDescription: formData.shortDescription || '',
  };

  // Visibility
  if (formData.visibleIn && formData.visibleIn.length > 0) {
    payload.visibleIn = formData.visibleIn;
  }

  // Meta tags
  if (formData.metaTitle || formData.metaDescription || formData.metaKeywords) {
    payload.metaTags = {};
    if (formData.metaTitle) payload.metaTags.title = formData.metaTitle;
    if (formData.metaDescription) payload.metaTags.description = formData.metaDescription;
    if (formData.metaKeywords) {
      payload.metaTags.keywords = formData.metaKeywords.split(',').map((k) => k.trim()).filter((k) => k);
    }
  }

  // Attributes
  if (formData.attributes && formData.attributes.length > 0) {
    payload.attributes = formData.attributes.map((attr) => ({
      code: attr.code,
      type: attr.type,
      values: [attr.value],
    }));
  }

  // Images
  if (formData.images && formData.images.length > 0) {
    payload.images = formData.images.map((img) => ({
      url: img.url,
      label: img.label || formData.name,
      roles: img.roles ? img.roles.split(',').map((r) => r.trim().toUpperCase()).filter((r) => r) : ['THUMBNAIL', 'BASE', 'SMALL'],
    }));
  }

  // Links (related products)
  if (formData.links && formData.links.length > 0) {
    payload.links = formData.links.map((link) => ({
      sku: link.sku,
      type: link.type,
    }));
  }

  // Routes
  if (formData.routes && formData.routes.length > 0) {
    payload.routes = formData.routes.map((route) => ({
      path: route.path,
    }));
  }

  return payload;
}

/**
 * Build the price payload for ACO Catalog Ingestion API
 * Based on @adobe-commerce/aco-ts-sdk FeedPrices type
 */
function buildPricePayload(sku, price, priceBookId) {
  return {
    sku,
    priceBookId,
    regular: parseFloat(price) || 0,
  };
}

/**
 * Submit product to ACO Catalog Ingestion API
 * Uses direct REST API calls with the access token from DA SDK
 *
 * API Reference:
 * POST https://na1-sandbox.api.commerce.adobe.com/{{tenantId}}/v1/feeds/products
 * POST https://na1-sandbox.api.commerce.adobe.com/{{tenantId}}/v1/feeds/prices
 */
async function submitProductToACO(productPayload, pricePayload) {
  // Ensure we have an access token
  await ensureAccessToken();

  if (!accessToken) {
    throw new Error('No access token available. Please ensure you are authenticated.');
  }

  console.log('Using access token for submit:', accessToken.substring(0, 50) + '...');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  try {
    // Step 1: Create the product
    console.log('Creating product in ACO...', productPayload);

    const productResponse = await fetch(ACO_PRODUCTS_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify([productPayload]), // API expects an array of products
    });

    if (!productResponse.ok) {
      const errorText = await productResponse.text();
      console.error('Product creation failed:', errorText);
      throw new Error(`Failed to create product: ${productResponse.status} - ${errorText}`);
    }

    const productResult = await productResponse.json();
    console.log('Product creation response:', productResult);

    // Step 2: Create the price
    console.log('Creating price in ACO...', pricePayload);

    const priceResponse = await fetch(ACO_PRICES_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify([pricePayload]), // API expects an array of prices
    });

    if (!priceResponse.ok) {
      const errorText = await priceResponse.text();
      console.error('Price creation failed:', errorText);
      throw new Error(`Failed to create price: ${priceResponse.status} - ${errorText}`);
    }

    const priceResult = await priceResponse.json();
    console.log('Price creation response:', priceResult);

    return {
      product: productResult,
      price: priceResult,
    };
  } catch (error) {
    console.error('Error submitting to ACO:', error);
    throw error;
  }
}

/**
 * Handle form submission
 */
/**
 * Extract dynamic list items from the form
 */
function extractDynamicListItems(form, listId, fieldNames) {
  const container = form.querySelector(`#${listId}-items`);
  if (!container) return [];

  const items = [];
  const itemElements = container.querySelectorAll('.plp-dynamic-item');

  itemElements.forEach((itemEl) => {
    const item = {};
    let hasValue = false;

    fieldNames.forEach((fieldName) => {
      const input = itemEl.querySelector(`[name*="[${fieldName}]"]`);
      if (input) {
        const value = input.value.trim();
        item[fieldName] = value;
        if (value) hasValue = true;
      }
    });

    // Only add items that have at least one value
    if (hasValue) {
      items.push(item);
    }
  });

  return items;
}

/**
 * Get checked values from checkbox group
 */
function getCheckedValues(form, name) {
  const checkboxes = form.querySelectorAll(`input[name="${name}"]:checked`);
  return Array.from(checkboxes).map((cb) => cb.value);
}

async function handleProductSubmit(form) {
  if (modalState.isSubmitting) return;

  // Get basic form values
  const formData = {
    // Basic info
    sku: form.querySelector('#product-sku')?.value.trim() || '',
    name: form.querySelector('#product-name')?.value.trim() || '',
    slug: form.querySelector('#product-slug')?.value.trim() || '',
    status: form.querySelector('#product-status')?.value || 'ENABLED',

    // Descriptions
    shortDescription: form.querySelector('#product-short-description')?.value.trim() || '',
    description: form.querySelector('#product-description')?.value.trim() || '',

    // Visibility
    visibleIn: getCheckedValues(form, 'product-visible-in'),

    // Meta tags
    metaTitle: form.querySelector('#product-meta-title')?.value.trim() || '',
    metaDescription: form.querySelector('#product-meta-description')?.value.trim() || '',
    metaKeywords: form.querySelector('#product-meta-keywords')?.value.trim() || '',

    // Dynamic lists
    attributes: extractDynamicListItems(form, 'product-attributes', ['code', 'type', 'value']),
    images: extractDynamicListItems(form, 'product-images', ['url', 'label', 'roles']),
    links: extractDynamicListItems(form, 'product-links', ['sku', 'type']),
    routes: extractDynamicListItems(form, 'product-routes', ['path']),

    // Pricing
    price: form.querySelector('#product-price')?.value || '0',
  };

  // Validate required fields
  if (!formData.name || !formData.sku) {
    showFormError('Product Name and SKU are required.');
    return;
  }

  // Build payloads
  const productPayload = buildProductPayload(formData);
  const pricePayload = buildPricePayload(formData.sku, formData.price, DEFAULT_PRICE_BOOK);

  console.log('Product Payload (ACO FeedProduct format):', productPayload);
  console.log('Price Payload (ACO FeedPrices format):', pricePayload);

  // Update UI state
  modalState.isSubmitting = true;
  updateSubmitButton(true);

  try {
    // Submit to ACO
    const result = await submitProductToACO(productPayload, pricePayload);
    console.log('Product created successfully:', result);

    // Success - close modal and refresh products
    closeModal();
    showSuccessMessage(`Product "${formData.name}" added successfully!`);

    // Refresh product list (note: ingestion is async, may take time to appear)
    state.currentPage = 1;
    await loadProducts();
  } catch (error) {
    console.error('Failed to create product:', error);
    showFormError(`Failed to create product: ${error.message}`);
  } finally {
    modalState.isSubmitting = false;
    updateSubmitButton(false);
  }
}

function updateSubmitButton(isLoading) {
  const submitBtn = document.querySelector('.plp-modal-submit');
  if (submitBtn) {
    submitBtn.disabled = isLoading;
    const span = submitBtn.querySelector('span');
    if (span) {
      span.textContent = isLoading ? 'Adding...' : 'Add Product';
    }
    if (isLoading) {
      submitBtn.classList.add('is-loading');
    } else {
      submitBtn.classList.remove('is-loading');
    }
  }
}

function showFormError(message) {
  // Simple alert for now - could be enhanced with inline errors
  alert(message);
}

function showSuccessMessage(message) {
  // Simple notification - could be enhanced with a toast component
  console.log('Success:', message);
}

function createFormSection(title) {
  const section = document.createElement('div');
  section.className = 'plp-form-section';

  const sectionTitle = document.createElement('h3');
  sectionTitle.className = 'plp-form-section-title';
  sectionTitle.textContent = title;
  section.appendChild(sectionTitle);

  return section;
}

function createCheckboxGroup(id, labelText, options, defaultValues = []) {
  const group = document.createElement('div');
  group.className = 'plp-form-group';

  const label = document.createElement('label');
  label.className = 'plp-form-label';
  label.textContent = labelText;
  group.appendChild(label);

  const checkboxContainer = document.createElement('div');
  checkboxContainer.className = 'plp-checkbox-group';

  options.forEach((option) => {
    const checkboxLabel = document.createElement('label');
    checkboxLabel.className = 'plp-checkbox-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = id;
    checkbox.value = option.value;
    checkbox.checked = defaultValues.includes(option.value);

    checkboxLabel.appendChild(checkbox);
    checkboxLabel.appendChild(document.createTextNode(` ${option.label}`));
    checkboxContainer.appendChild(checkboxLabel);
  });

  group.appendChild(checkboxContainer);
  return group;
}

function createSelectGroup(id, labelText, options, defaultValue = '') {
  const group = document.createElement('div');
  group.className = 'plp-form-group';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.className = 'plp-form-label';
  label.textContent = labelText;
  group.appendChild(label);

  const select = document.createElement('select');
  select.id = id;
  select.className = 'plp-form-input plp-form-select';

  options.forEach((option) => {
    const optionEl = document.createElement('option');
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    if (option.value === defaultValue) {
      optionEl.selected = true;
    }
    select.appendChild(optionEl);
  });

  group.appendChild(select);
  return group;
}

function createDynamicListSection(id, title, fields, addButtonText) {
  const section = document.createElement('div');
  section.className = 'plp-form-group plp-dynamic-list';
  section.dataset.listId = id;

  const label = document.createElement('label');
  label.className = 'plp-form-label';
  label.textContent = title;
  section.appendChild(label);

  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'plp-dynamic-items';
  itemsContainer.id = `${id}-items`;
  section.appendChild(itemsContainer);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'plp-button plp-button-secondary plp-add-item-btn';
  addBtn.textContent = `+ ${addButtonText}`;
  addBtn.addEventListener('click', () => {
    const item = createDynamicListItem(id, fields, itemsContainer.children.length);
    itemsContainer.appendChild(item);
  });
  section.appendChild(addBtn);

  return section;
}

function createDynamicListItem(listId, fields, index) {
  const item = document.createElement('div');
  item.className = 'plp-dynamic-item';

  const fieldsContainer = document.createElement('div');
  fieldsContainer.className = 'plp-dynamic-item-fields';

  fields.forEach((field) => {
    const fieldWrapper = document.createElement('div');
    fieldWrapper.className = 'plp-dynamic-field';

    if (field.type === 'select') {
      const select = document.createElement('select');
      select.name = `${listId}[${index}][${field.name}]`;
      select.className = 'plp-form-input plp-form-select';
      field.options.forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
      });
      fieldWrapper.appendChild(select);
    } else {
      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.name = `${listId}[${index}][${field.name}]`;
      input.placeholder = field.placeholder;
      input.className = 'plp-form-input';
      fieldWrapper.appendChild(input);
    }

    fieldsContainer.appendChild(fieldWrapper);
  });

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'plp-dynamic-remove-btn';
  removeBtn.innerHTML = '&times;';
  removeBtn.setAttribute('aria-label', 'Remove item');
  removeBtn.addEventListener('click', () => item.remove());

  item.appendChild(fieldsContainer);
  item.appendChild(removeBtn);

  return item;
}

function createModal() {
  const modal = document.createElement('div');
  modal.id = 'add-product-modal';
  modal.className = 'plp-modal';

  const overlay = document.createElement('div');
  overlay.className = 'plp-modal-overlay';
  overlay.addEventListener('click', closeModal);

  const dialog = document.createElement('div');
  dialog.className = 'plp-modal-dialog plp-modal-dialog-large';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'modal-title');

  // Header
  const header = document.createElement('div');
  header.className = 'plp-modal-header';

  const title = document.createElement('h2');
  title.id = 'modal-title';
  title.className = 'plp-modal-title';
  title.textContent = 'Add New Product';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'plp-modal-close';
  closeBtn.setAttribute('aria-label', 'Close modal');
  closeBtn.appendChild(createIcon('close'));
  closeBtn.addEventListener('click', closeModal);

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'plp-modal-body';

  // Form
  const form = document.createElement('form');
  form.className = 'plp-modal-form';
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleProductSubmit(form);
  });

  // ===== BASIC INFO SECTION =====
  const basicSection = createFormSection('Basic Information');

  const skuGroup = createFormGroup('product-sku', 'SKU *', 'text', 'e.g., wknd-bolt-sneakers-2013', true);
  const nameGroup = createFormGroup('product-name', 'Product Name *', 'text', 'Enter product name', true);
  const slugGroup = createFormGroup('product-slug', 'Slug', 'text', 'auto-generated-from-name');
  const statusGroup = createSelectGroup('product-status', 'Status', [
    { value: 'ENABLED', label: 'Enabled' },
    { value: 'DISABLED', label: 'Disabled' },
  ], 'ENABLED');

  basicSection.appendChild(skuGroup);
  basicSection.appendChild(nameGroup);
  basicSection.appendChild(slugGroup);
  basicSection.appendChild(statusGroup);
  form.appendChild(basicSection);

  // ===== DESCRIPTIONS SECTION =====
  const descSection = createFormSection('Descriptions');

  const shortDescGroup = createFormGroup('product-short-description', 'Short Description', 'text', 'Brief product summary');

  const descGroup = document.createElement('div');
  descGroup.className = 'plp-form-group';
  const descLabel = document.createElement('label');
  descLabel.htmlFor = 'product-description';
  descLabel.className = 'plp-form-label';
  descLabel.textContent = 'Description';
  const descTextarea = document.createElement('textarea');
  descTextarea.id = 'product-description';
  descTextarea.className = 'plp-form-input plp-form-textarea';
  descTextarea.placeholder = 'Enter detailed product description';
  descTextarea.rows = 3;
  descGroup.appendChild(descLabel);
  descGroup.appendChild(descTextarea);

  descSection.appendChild(shortDescGroup);
  descSection.appendChild(descGroup);
  form.appendChild(descSection);

  // ===== VISIBILITY SECTION =====
  const visibilitySection = createFormSection('Visibility');

  const visibleInGroup = createCheckboxGroup('product-visible-in', 'Visible In', [
    { value: 'CATALOG', label: 'Catalog' },
    { value: 'SEARCH', label: 'Search' },
  ], ['CATALOG', 'SEARCH']);

  visibilitySection.appendChild(visibleInGroup);
  form.appendChild(visibilitySection);

  // ===== SEO / META TAGS SECTION =====
  const seoSection = createFormSection('SEO / Meta Tags');

  const metaTitleGroup = createFormGroup('product-meta-title', 'Meta Title', 'text', 'SEO title');
  const metaDescGroup = createFormGroup('product-meta-description', 'Meta Description', 'text', 'SEO description');
  const metaKeywordsGroup = createFormGroup('product-meta-keywords', 'Meta Keywords', 'text', 'keyword1, keyword2, keyword3');

  seoSection.appendChild(metaTitleGroup);
  seoSection.appendChild(metaDescGroup);
  seoSection.appendChild(metaKeywordsGroup);
  form.appendChild(seoSection);

  // ===== ATTRIBUTES SECTION =====
  const attributesSection = createFormSection('Attributes');

  const attributesList = createDynamicListSection('product-attributes', '', [
    { name: 'code', placeholder: 'Attribute code (e.g., brand)', type: 'text' },
    {
      name: 'type',
      type: 'select',
      options: [
        { value: 'STRING', label: 'String' },
        { value: 'NUMBER', label: 'Number' },
        { value: 'BOOLEAN', label: 'Boolean' },
      ],
    },
    { name: 'value', placeholder: 'Value', type: 'text' },
  ], 'Add Attribute');

  attributesSection.appendChild(attributesList);
  form.appendChild(attributesSection);

  // ===== IMAGES SECTION =====
  const imagesSection = createFormSection('Images');

  const imagesList = createDynamicListSection('product-images', '', [
    { name: 'url', placeholder: 'Image URL', type: 'url' },
    { name: 'label', placeholder: 'Image label', type: 'text' },
    { name: 'roles', placeholder: 'Roles (THUMBNAIL, BASE, SMALL)', type: 'text' },
  ], 'Add Image');

  imagesSection.appendChild(imagesList);
  form.appendChild(imagesSection);

  // ===== LINKS SECTION =====
  const linksSection = createFormSection('Related Products');

  const linksList = createDynamicListSection('product-links', '', [
    { name: 'sku', placeholder: 'Related product SKU', type: 'text' },
    {
      name: 'type',
      type: 'select',
      options: [
        { value: 'related', label: 'Related' },
        { value: 'upsell', label: 'Upsell' },
        { value: 'crosssell', label: 'Cross-sell' },
      ],
    },
  ], 'Add Link');

  linksSection.appendChild(linksList);
  form.appendChild(linksSection);

  // ===== ROUTES SECTION =====
  const routesSection = createFormSection('Routes');

  const routesList = createDynamicListSection('product-routes', '', [
    { name: 'path', placeholder: 'Route path (e.g., sneakers)', type: 'text' },
  ], 'Add Route');

  routesSection.appendChild(routesList);
  form.appendChild(routesSection);

  // ===== PRICING SECTION =====
  const pricingSection = createFormSection('Pricing');

  const priceGroup = createFormGroup('product-price', 'Price (USD)', 'number', '0.00');

  pricingSection.appendChild(priceGroup);
  form.appendChild(pricingSection);

  body.appendChild(form);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'plp-modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'plp-button plp-modal-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeModal);

  const submitBtn = document.createElement('button');
  submitBtn.type = 'submit';
  submitBtn.className = 'plp-button plp-modal-submit';
  const submitBtnText = document.createElement('span');
  submitBtnText.textContent = 'Add Product';
  submitBtn.appendChild(submitBtnText);
  submitBtn.addEventListener('click', () => {
    form.dispatchEvent(new Event('submit'));
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(submitBtn);

  dialog.appendChild(header);
  dialog.appendChild(body);
  dialog.appendChild(footer);

  modal.appendChild(overlay);
  modal.appendChild(dialog);

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      closeModal();
    }
  });

  return modal;
}

function createFormGroup(id, labelText, inputType, placeholder, required = false) {
  const group = document.createElement('div');
  group.className = 'plp-form-group';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;

  const input = document.createElement('input');
  input.type = inputType;
  input.id = id;
  input.className = 'plp-form-input';
  input.placeholder = placeholder;
  if (required) {
    input.required = true;
  }
  if (inputType === 'number') {
    input.step = '0.01';
    input.min = '0';
  }

  group.appendChild(label);
  group.appendChild(input);
  return group;
}

function createSelect(options, selectedValue, onChange, className = '') {
  const select = document.createElement('select');
  select.className = `plp-select ${className}`;
  options.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedValue;
    select.appendChild(option);
  });
  select.addEventListener('change', (e) => onChange(e.target.value));
  return select;
}

function createButton(text, onClick, className = '', icon = null) {
  const button = document.createElement('button');
  button.className = `plp-button ${className}`;
  if (icon) button.appendChild(createIcon(icon));
  if (text) {
    const span = document.createElement('span');
    span.textContent = text;
    button.appendChild(span);
  }
  button.addEventListener('click', onClick);
  return button;
}

function createProductCard(product) {
  const card = document.createElement('div');
  card.className = 'plp-product-card';
  card.style.cursor = 'pointer';
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Edit ${product.name}`);

  // Click handler to open edit modal
  card.addEventListener('click', (e) => {
    // Don't open edit modal if clicking delete button
    if (e.target.closest('.plp-delete-btn')) {
      return;
    }
    openEditModal(product);
  });

  // Keyboard support
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openEditModal(product);
    }
  });

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'plp-delete-btn';
  deleteBtn.setAttribute('aria-label', `Delete ${product.name}`);
  deleteBtn.setAttribute('title', 'Delete product');
  deleteBtn.innerHTML = createIcon('delete').innerHTML;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleProductDelete(product, card);
  });
  card.appendChild(deleteBtn);

  const imageContainer = document.createElement('div');
  imageContainer.className = 'plp-product-image-container';

  // Show all images or placeholder if none
  const images = product.images && product.images.length > 0
    ? product.images
    : [{ url: 'https://via.placeholder.com/300', label: 'No image' }];

  if (images.length === 1) {
    // Single image - show full size
    const img = document.createElement('img');
    img.src = images[0].url;
    img.alt = images[0].label || product.name;
    img.className = 'plp-product-image';
    img.loading = 'lazy';
    imageContainer.appendChild(img);
  } else {
    // Multiple images - show gallery grid
    const gallery = document.createElement('div');
    gallery.className = 'plp-product-gallery';

    images.forEach((image, index) => {
      const imgWrapper = document.createElement('div');
      imgWrapper.className = 'plp-product-gallery-item';

      const img = document.createElement('img');
      img.src = image.url;
      img.alt = image.label || `${product.name} image ${index + 1}`;
      img.className = 'plp-product-image';
      img.loading = 'lazy';

      // Show role badge if available
      if (image.roles && image.roles.length > 0) {
        const badge = document.createElement('span');
        badge.className = 'plp-image-role-badge';
        badge.textContent = image.roles[0];
        imgWrapper.appendChild(badge);
      }

      imgWrapper.appendChild(img);
      gallery.appendChild(imgWrapper);
    });

    imageContainer.appendChild(gallery);
  }

  const info = document.createElement('div');
  info.className = 'plp-product-info';

  // Category
  if (product.category) {
    const category = document.createElement('p');
    category.className = 'plp-product-category';
    category.textContent = capitalize(product.category);
    info.appendChild(category);
  }

  // Product Name
  const name = document.createElement('h3');
  name.className = 'plp-product-name';
  name.textContent = product.name;
  info.appendChild(name);

  // SKU
  const sku = document.createElement('p');
  sku.className = 'plp-product-sku';
  sku.textContent = `SKU: ${product.sku}`;
  info.appendChild(sku);

  // Price
  const priceContainer = document.createElement('div');
  priceContainer.className = 'plp-price-container';

  const priceInfo = document.createElement('div');
  priceInfo.className = 'plp-price-info';

  const currentPrice = document.createElement('span');
  currentPrice.className = 'plp-current-price';
  currentPrice.textContent = formatPrice(product.price?.final);
  priceInfo.appendChild(currentPrice);

  if (showDiscount(product.price, product.globalPrice)) {
    const originalPrice = document.createElement('span');
    originalPrice.className = 'plp-original-price';
    originalPrice.textContent = product.globalPrice && state.selectedPriceBook !== 'global'
      ? formatPrice(product.globalPrice.final)
      : formatPrice(product.price?.regular);
    priceInfo.appendChild(originalPrice);
  }

  priceContainer.appendChild(priceInfo);
  info.appendChild(priceContainer);

  // Short Description
  if (product.shortDescription) {
    const shortDesc = document.createElement('p');
    shortDesc.className = 'plp-product-short-desc';
    shortDesc.textContent = product.shortDescription;
    info.appendChild(shortDesc);
  }

  // Description
  if (product.description) {
    const desc = document.createElement('p');
    desc.className = 'plp-product-description';
    desc.textContent = product.description;
    info.appendChild(desc);
  }

  // Attributes
  if (product.attributes && product.attributes.length > 0) {
    const attrsContainer = document.createElement('div');
    attrsContainer.className = 'plp-product-attributes';

    const attrsTitle = document.createElement('p');
    attrsTitle.className = 'plp-product-attributes-title';
    attrsTitle.textContent = 'Attributes';
    attrsContainer.appendChild(attrsTitle);

    const attrsList = document.createElement('ul');
    attrsList.className = 'plp-product-attributes-list';

    product.attributes.forEach((attr) => {
      const attrItem = document.createElement('li');
      attrItem.className = 'plp-product-attribute';
      const label = attr.label || attr.name;
      attrItem.innerHTML = `<span class="attr-label">${label}:</span> <span class="attr-value">${attr.value}</span>`;
      attrsList.appendChild(attrItem);
    });

    attrsContainer.appendChild(attrsList);
    info.appendChild(attrsContainer);
  }

  // Meta Tags
  if (product.metaTags && (product.metaTags.title || product.metaTags.description || product.metaTags.keywords)) {
    const metaContainer = document.createElement('div');
    metaContainer.className = 'plp-product-metatags';

    const metaTitle = document.createElement('p');
    metaTitle.className = 'plp-product-metatags-title';
    metaTitle.textContent = 'Meta Tags';
    metaContainer.appendChild(metaTitle);

    const metaList = document.createElement('ul');
    metaList.className = 'plp-product-metatags-list';

    if (product.metaTags.title) {
      const titleItem = document.createElement('li');
      titleItem.className = 'plp-product-metatag';
      titleItem.innerHTML = `<span class="meta-label">Title:</span> <span class="meta-value">${product.metaTags.title}</span>`;
      metaList.appendChild(titleItem);
    }

    if (product.metaTags.description) {
      const descItem = document.createElement('li');
      descItem.className = 'plp-product-metatag';
      descItem.innerHTML = `<span class="meta-label">Description:</span> <span class="meta-value">${product.metaTags.description}</span>`;
      metaList.appendChild(descItem);
    }

    if (product.metaTags.keywords && product.metaTags.keywords.length > 0) {
      const keywordsItem = document.createElement('li');
      keywordsItem.className = 'plp-product-metatag';
      const keywordsStr = Array.isArray(product.metaTags.keywords)
        ? product.metaTags.keywords.join(', ')
        : product.metaTags.keywords;
      keywordsItem.innerHTML = `<span class="meta-label">Keywords:</span> <span class="meta-value">${keywordsStr}</span>`;
      metaList.appendChild(keywordsItem);
    }

    metaContainer.appendChild(metaList);
    info.appendChild(metaContainer);
  }

  card.appendChild(imageContainer);
  card.appendChild(info);

  return card;
}

// Render functions
function renderHeader(container) {
  const header = document.createElement('div');
  header.className = 'plp-header';

  const headerContent = document.createElement('div');
  headerContent.className = 'plp-header-content';

  const headerTop = document.createElement('div');
  headerTop.className = 'plp-header-top';

  const headerText = document.createElement('div');
  headerText.className = 'plp-header-text';

  const title = document.createElement('h1');
  title.className = 'plp-title';
  title.textContent = 'Product Collection';

  const subtitle = document.createElement('p');
  subtitle.className = 'plp-subtitle';
  subtitle.textContent = 'Discover our curated selection of premium products';

  headerText.appendChild(title);
  headerText.appendChild(subtitle);

  // Header buttons container
  const headerButtons = document.createElement('div');
  headerButtons.className = 'plp-header-buttons';

  // Authenticate button
  const tokenBtn = document.createElement('button');
  tokenBtn.className = 'plp-button plp-button-secondary plp-token-btn';
  tokenBtn.appendChild(createIcon('key'));
  const tokenBtnText = document.createElement('span');
  tokenBtnText.textContent = 'Authenticate';
  tokenBtn.appendChild(tokenBtnText);
  tokenBtn.addEventListener('click', () => handleAuthenticate(tokenBtn));

  // Paste a Product button
  const pasteBtn = document.createElement('button');
  pasteBtn.className = 'plp-button plp-button-secondary';
  pasteBtn.appendChild(createIcon('clipboard'));
  const pasteBtnText = document.createElement('span');
  pasteBtnText.textContent = 'Paste a Product';
  pasteBtn.appendChild(pasteBtnText);
  pasteBtn.addEventListener('click', openPasteModal);

  // Add New Product button
  const addProductBtn = document.createElement('button');
  addProductBtn.className = 'plp-button plp-add-product-btn';
  addProductBtn.appendChild(createIcon('plus'));
  const btnText = document.createElement('span');
  btnText.textContent = 'Add New Product';
  addProductBtn.appendChild(btnText);
  addProductBtn.addEventListener('click', openModal);

  headerButtons.appendChild(tokenBtn);
  headerButtons.appendChild(pasteBtn);
  headerButtons.appendChild(addProductBtn);

  headerTop.appendChild(headerText);
  headerTop.appendChild(headerButtons);

  // Filters container
  const filters = document.createElement('div');
  filters.className = 'plp-filters';

  // Search
  const searchContainer = document.createElement('div');
  searchContainer.className = 'plp-search-container';
  searchContainer.appendChild(createIcon('search'));

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search products...';
  searchInput.className = 'plp-search-input';
  searchInput.value = state.searchTerm;

  const debouncedSearch = debounce((value) => {
    state.searchTerm = value;
    state.currentPage = 1;
    loadProducts();
  }, 300);

  searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));
  searchContainer.appendChild(searchInput);

  // Category filter
  const categoryOptions = [
    { value: 'all', label: 'All Categories' },
    ...state.categories.map((cat) => ({ value: cat, label: capitalize(cat) })),
  ];
  const categorySelect = createSelect(categoryOptions, state.selectedCategory, (value) => {
    state.selectedCategory = value;
    filterAndRenderProducts();
  }, 'plp-category-select');

  // Sort dropdown
  const sortOptions = [
    { value: 'featured', label: 'Featured' },
    { value: 'price-low', label: 'Price: Low to High' },
    { value: 'price-high', label: 'Price: High to Low' },
    { value: 'newest', label: 'Newest' },
  ];
  const sortSelect = createSelect(sortOptions, state.sortBy, (value) => {
    state.sortBy = value;
    filterAndRenderProducts();
  }, 'plp-sort-select');

  // Price book filter
  const priceBookOptions = ALL_PRICE_BOOKS.map((pb) => ({
    value: pb,
    label: pb === 'global' ? 'Global Price Book' : 'VIP Price Book',
  }));
  const priceBookSelect = createSelect(priceBookOptions, state.selectedPriceBook, (value) => {
    state.selectedPriceBook = value;
    state.currentPage = 1;
    loadProducts();
  }, 'plp-pricebook-select');

  filters.appendChild(searchContainer);
  filters.appendChild(categorySelect);
  filters.appendChild(sortSelect);
  filters.appendChild(priceBookSelect);

  headerContent.appendChild(headerTop);
  headerContent.appendChild(filters);
  header.appendChild(headerContent);
  container.appendChild(header);
}

function renderResultsHeader(container) {
  const resultsHeader = document.createElement('div');
  resultsHeader.className = 'plp-results-header';

  const resultsText = document.createElement('p');
  resultsText.className = 'plp-results-text';
  resultsText.innerHTML = `Showing <strong>1-${state.filteredProducts.length}</strong> of <strong>${state.totalCount}</strong> results`;

  const viewToggle = document.createElement('div');
  viewToggle.className = 'plp-view-toggle';
  viewToggle.appendChild(createButton('', () => {}, 'plp-view-btn active', 'grid'));
  viewToggle.appendChild(createButton('', () => {}, 'plp-view-btn', 'list'));

  resultsHeader.appendChild(resultsText);
  resultsHeader.appendChild(viewToggle);
  container.appendChild(resultsHeader);
}

function renderProductGrid(container) {
  let grid = container.querySelector('.plp-product-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'plp-product-grid';
    container.appendChild(grid);
  } else {
    grid.innerHTML = '';
  }

  state.filteredProducts.forEach((product) => {
    grid.appendChild(createProductCard(product));
  });
}

function renderLoadMore(container) {
  const existing = container.querySelector('.plp-load-more-container');
  if (existing) existing.remove();

  if (state.filteredProducts.length >= state.totalCount) return;

  const loadMoreContainer = document.createElement('div');
  loadMoreContainer.className = 'plp-load-more-container';

  const loadMoreBtn = createButton(
    state.isLoading ? 'Loading...' : 'Load More Products',
    handleLoadMore,
    'plp-load-more-btn',
    state.isLoading ? 'loader' : null,
  );
  loadMoreBtn.disabled = state.isLoading;

  loadMoreContainer.appendChild(loadMoreBtn);
  container.appendChild(loadMoreContainer);
}

// Data functions
async function loadProducts(append = false) {
  state.isLoading = true;
  updateLoadingState();

  try {
    const result = await searchProducts(
      CATALOG_VIEW_ID,
      DEFAULT_LOCALE,
      state.selectedPriceBook,
      state.searchTerm,
      PAGE_SIZE,
      state.currentPage,
    );

    if (append) {
      state.products = [...state.products, ...result.products];
    } else {
      state.products = result.products;
    }
    state.totalCount = result.totalCount;

    // Extract categories
    const newCategories = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
    state.categories = [...new Set([...state.categories, ...newCategories])];

    filterAndRenderProducts();
  } catch (error) {
    console.error('Error loading products:', error);
  } finally {
    state.isLoading = false;
    updateLoadingState();
  }
}

function filterAndRenderProducts() {
  let filtered = [...state.products];

  // Filter by category
  if (state.selectedCategory !== 'all') {
    filtered = filtered.filter((p) => p.category === state.selectedCategory);
  }

  // Sort products
  switch (state.sortBy) {
    case 'price-low':
      filtered.sort((a, b) => (a.price?.final?.amount?.value || 0) - (b.price?.final?.amount?.value || 0));
      break;
    case 'price-high':
      filtered.sort((a, b) => (b.price?.final?.amount?.value || 0) - (a.price?.final?.amount?.value || 0));
      break;
    case 'newest':
      filtered.reverse();
      break;
    default:
      break;
  }

  state.filteredProducts = filtered;
  renderProducts();
}

function renderProducts() {
  const mainContent = document.querySelector('.plp-main-content');
  if (!mainContent) return;

  // Update results header
  const resultsHeader = mainContent.querySelector('.plp-results-header');
  if (resultsHeader) {
    const resultsText = resultsHeader.querySelector('.plp-results-text');
    if (resultsText) {
      resultsText.innerHTML = `Showing <strong>1-${state.filteredProducts.length}</strong> of <strong>${state.totalCount}</strong> results`;
    }
  }

  renderProductGrid(mainContent);
  renderLoadMore(mainContent);
}

function updateLoadingState() {
  const loadMoreBtn = document.querySelector('.plp-load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.disabled = state.isLoading;
    const span = loadMoreBtn.querySelector('span');
    if (span) span.textContent = state.isLoading ? 'Loading...' : 'Load More Products';
  }
}

async function handleLoadMore() {
  state.currentPage += 1;
  await loadProducts(true);
}

// Main initialization
function renderProductListPage(container) {
  container.innerHTML = '';
  container.className = 'product-list-page';

  renderHeader(container);

  const mainContent = document.createElement('div');
  mainContent.className = 'plp-main-content';

  renderResultsHeader(mainContent);
  renderProductGrid(mainContent);
  renderLoadMore(mainContent);

  container.appendChild(mainContent);
}

(async function init() {
  const { context, token, actions } = await DA_SDK;
  console.log('DA SDK Context:', context);

  // Check sessionStorage for saved token first
  // Use DA SDK token if available
  if (token) {
    accessToken = token;
    console.log('Using DA SDK token');
  }
  console.log('Access token available:', !!accessToken);

  // Create main container
  const container = document.createElement('div');
  container.id = 'product-list-container';
  document.body.appendChild(container);

  // Add stylesheet
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/tools/products/products.css';
  document.head.appendChild(link);

  // Initialize and render
  renderProductListPage(container);

  // Add modals to the page
  const addModal = createModal();
  document.body.appendChild(addModal);

  const pasteModal = createPasteModal();
  document.body.appendChild(pasteModal);

  const editModal = createEditModal();
  document.body.appendChild(editModal);

  await loadProducts();
}());