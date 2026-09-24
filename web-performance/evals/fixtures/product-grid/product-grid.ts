interface Product {
  id: string;
  name: string;
  price: number;
  image: string; // full-size image URL, about 1600 px wide
}

async function loadProducts(): Promise<Product[]> {
  const response = await fetch('/api/products?limit=2000');
  return response.json();
}

function render(grid: HTMLElement, products: Product[]) {
  grid.innerHTML = '';
  for (const product of products) {
    grid.innerHTML += `
      <article class="card" data-id="${product.id}">
        <img src="${product.image}" alt="${product.name}" />
        <h2>${product.name}</h2>
        <p>$${product.price.toFixed(2)}</p>
      </article>`;
  }
  for (const card of grid.querySelectorAll<HTMLElement>('.card')) {
    card.addEventListener('click', () => {
      const cart = JSON.parse(localStorage.getItem('cart') ?? '[]');
      cart.push(card.dataset.id);
      localStorage.setItem('cart', JSON.stringify(cart));
    });
  }
}

// Fade the cards that are far from the middle of the screen.
function onScroll(grid: HTMLElement) {
  for (const card of grid.querySelectorAll<HTMLElement>('.card')) {
    const box = card.getBoundingClientRect();
    const far = Math.abs(box.top + box.height / 2 - window.innerHeight / 2) > window.innerHeight;
    card.classList.toggle('faded', far);
    card.style.transform = far ? 'scale(0.98)' : '';
  }
}

export async function mountProductGrid() {
  const grid = document.getElementById('grid')!;
  const products = await loadProducts();
  render(grid, products);
  window.addEventListener('scroll', () => onScroll(grid));
  window.addEventListener('resize', () => render(grid, products));
}

mountProductGrid();
