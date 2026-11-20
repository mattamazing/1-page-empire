// Mindflow Cart - slide-out drawer with localStorage

let cart = JSON.parse(localStorage.getItem('mindflow_cart') || '[]');

function saveCart() {
  localStorage.setItem('mindflow_cart', JSON.stringify(cart));
  updateCartUI();
}

function updateCartUI() {
  const countEl = document.getElementById('cart-count');
  const itemsEl = document.getElementById('cart-items');
  const totalEl = document.getElementById('cart-total');
  const emptyEl = document.getElementById('empty-cart');

  const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
  if (countEl) countEl.textContent = totalItems;

  if (!itemsEl) return;

  if (cart.length === 0) {
    itemsEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    if (totalEl) totalEl.textContent = '$0.00';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  itemsEl.innerHTML = cart.map((item, i) => `
    <div class="cart-item">
      <img src="${item.image || 'images/4Kfrz.jpg'}" alt="">
      <div class="cart-item-info">
        <div class="cart-item-title">${item.name}</div>
        <div class="cart-item-price">$${item.price.toFixed(2)}</div>
        <div class="qty-controls">
          <button onclick="changeQty(${i}, -1)">−</button>
          <span>${item.qty}</span>
          <button onclick="changeQty(${i}, 1)">+</button>
          <button onclick="removeItem(${i})" style="margin-left:8px;background:none;color:#e63946;">✕</button>
        </div>
      </div>
    </div>
  `).join('');

  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  if (totalEl) totalEl.textContent = `$${total.toFixed(2)}`;
}

function addToCart(name, price, image) {
  const existing = cart.find(item => item.name === name);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ name, price: parseFloat(price), qty: 1, image });
  }
  saveCart();
  openCart();
}

function changeQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCart();
}

function removeItem(index) {
  cart.splice(index, 1);
  saveCart();
}

function openCart() {
  document.getElementById('cart-overlay').classList.add('active');
  document.getElementById('cart-drawer').classList.add('open');
}

function closeCart() {
  document.getElementById('cart-overlay').classList.remove('active');
  document.getElementById('cart-drawer').classList.remove('open');
}

function toggleMobileNav() {
  document.getElementById('mobile-nav').classList.toggle('active');
}

function toggleFaq(el) {
  el.parentElement.classList.toggle('open');
}

// Init
document.addEventListener('DOMContentLoaded', updateCartUI);

// Make functions global for onclick
window.addToCart = addToCart;
window.changeQty = changeQty;
window.removeItem = removeItem;
window.openCart = openCart;
window.closeCart = closeCart;
window.toggleMobileNav = toggleMobileNav;
window.toggleFaq = toggleFaq;
