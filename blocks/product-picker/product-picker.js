import { createOptimizedPicture } from '../../scripts/aem.js';

export default async function decorate(block) {
  const products = 'https://main--basspro--adobedevxsc.aem.page/demo-pp/bps.json';

  const lastDiv = [...block.children].pop();
  let skus = lastDiv.querySelector('p');
  skus = skus ? skus.textContent.split(',') : [''];
  const ul = document.createElement('ul');

  console.log("skus", skus);

  const productsResponse = await fetch(products);
  if (productsResponse.ok) {
    const p = await productsResponse.json();
    console.log("product picker data", p);
    p.data.forEach(product => skus.forEach(sku => {
      if (product.SKU === sku) {
        const li = document.createElement('li');
        const div = document.createElement('div');
        div.className = 'product-card-image';
        // const optimizedPic = createOptimizedPicture(product['Image {width:80}'], 'DM Image', false, [{ width: '750' }]);
        div.innerHTML = `<img src="${product['Image {width:80}']}" alt="${product['Product Name']}">`;
        const p = document.createElement('p');
        p.textContent = product['Product Name'];
        li.append(div, p);
        ul.append(li);
      }
    }));
  }
  const place =lastDiv.querySelector('div');
  place.append(ul);
  // block.append(ul);
}

