(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmt = (value) => new Intl.NumberFormat('bn-BD').format(Number(value) || 0);
  const cleanCategory = (value) => String(value || '').replace(/\s*[（(][০-৯0-9,]+[）)]\s*$/, '').trim();
  const stockText = { in: 'স্টকে আছে', out: 'স্টক শেষ', unknown: 'তথ্য নেই' };
  const PAGE_SIZE = 40;
  const API_BASE = String(window.STYLE_GRID_API || '').trim().replace(/\/+$/, '');
  const SESSION_KEY = 'style-grid-admin-session';
  const state = { products: [], filtered: [], page: 1, editingSku: null, deletingSku: null, descriptionCache: new Map(), searchTimer: null, token: sessionStorage.getItem(SESSION_KEY) || '' };

  const refs = {
    loginView: $('loginView'), appShell: $('appShell'), loginForm: $('loginForm'), loginEmail: $('loginEmail'), loginPassword: $('loginPassword'), loginFeedback: $('loginFeedback'), loginSubmit: $('loginSubmit'),
    screenHeading: $('screenHeading'), loginHeadingSlot: $('loginHeadingSlot'), appHeadingSlot: $('appHeadingSlot'),
    accountEmail: $('accountEmail'), logoutButton: $('logoutButton'), menuButton: $('menuButton'), sidebar: $('sidebar'), navScrim: $('navScrim'),
    search: $('searchInput'), category: $('categoryFilter'), stock: $('stockFilter'), sort: $('sortFilter'), rows: $('productRows'), range: $('resultRange'), resultStatus: $('resultStatus'), pageInfo: $('pageInfo'), previous: $('previousPage'), next: $('nextPage'), empty: $('emptyState'), error: $('errorState'), errorText: $('errorText'), retry: $('retryButton'), pagination: $('pagination'),
    add: $('addProductButton'), emptyAdd: $('emptyAddButton'), productDialog: $('productDialog'), productForm: $('productForm'), editorTitle: $('editorTitle'), editorSubtitle: $('editorSubtitle'), formFeedback: $('formFeedback'), saveButton: $('saveProductButton'), closeEditor: $('closeEditor'), cancelEditor: $('cancelEditor'),
    sku: $('fieldSku'), name: $('fieldName'), mainCategory: $('fieldMainCategory'), subCategory: $('fieldSubCategory'), price: $('fieldPrice'), sizes: $('fieldSizes'), productStock: $('fieldStock'), image: $('fieldImage'), description: $('fieldDescription'),
    deleteDialog: $('deleteDialog'), deleteForm: $('deleteForm'), deleteCopy: $('deleteCopy'), deleteFeedback: $('deleteFeedback'), cancelDelete: $('cancelDelete'), confirmDelete: $('confirmDeleteButton')
  };

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const token = state.token || sessionStorage.getItem(SESSION_KEY) || '';
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(API_BASE ? `${API_BASE}${path}` : path, {
      ...options,
      headers,
      credentials: 'omit',
      mode: API_BASE ? 'cors' : 'same-origin',
      cache: 'no-store'
    });
    let data = {};
    try { data = await response.json(); } catch { /* keep a useful generic error */ }
    if (!response.ok) throw new ApiError(data.error || 'অনুরোধটি সম্পন্ন করা যায়নি।', response.status);
    return data;
  }

  function setFeedback(element, message = '', kind = '') {
    element.textContent = message;
    element.classList.toggle('error', kind === 'error');
    element.classList.toggle('success', kind === 'success');
  }

  function showLogin(message = '') {
    refs.loginHeadingSlot.append(refs.screenHeading);
    refs.screenHeading.textContent = 'পণ্য ব্যবস্থাপনা';
    refs.appShell.hidden = true;
    refs.loginView.hidden = false;
    if (message) setFeedback(refs.loginFeedback, message, 'error');
    refs.loginEmail.focus();
  }

  function showWorkspace(email) {
    refs.appHeadingSlot.prepend(refs.screenHeading);
    refs.screenHeading.textContent = 'পণ্য তালিকা';
    refs.loginView.hidden = true;
    refs.appShell.hidden = false;
    refs.accountEmail.textContent = email || '';
  }

  async function checkSession() {
    if (!state.token) { showLogin(); return; }
    try {
      const session = await api('/api/admin/session');
      if (!session.authenticated) { showLogin(); return; }
      showWorkspace(session.email);
      await loadProducts();
    } catch (error) {
      if (error.status === 401) { clearSession(); showLogin(); }
      else showLogin(error.message || 'অ্যাডমিন সেবা এখন পাওয়া যাচ্ছে না।');
    }
  }

  function clearSession() {
    state.token = '';
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function submitLogin(event) {
    event.preventDefault();
    setFeedback(refs.loginFeedback, 'সাইন ইন করা হচ্ছে…');
    refs.loginSubmit.disabled = true;
    try {
      const data = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email: refs.loginEmail.value.trim(), password: refs.loginPassword.value })
      });
      if (!data.token) throw new ApiError('সাইন ইন সেশন পাওয়া যায়নি।', 500);
      state.token = data.token;
      sessionStorage.setItem(SESSION_KEY, data.token);
      refs.loginPassword.value = '';
      showWorkspace(data.email);
      await loadProducts();
    } catch (error) {
      if (error.status === 401 || error.status === 429) clearSession();
      setFeedback(refs.loginFeedback, error.status === 429 ? 'অনেকবার চেষ্টা হয়েছে। ১০ মিনিট পরে আবার চেষ্টা করুন।' : (error.message || 'সাইন ইন করা যায়নি।'), 'error');
    } finally {
      refs.loginSubmit.disabled = false;
    }
  }

  async function logout() {
    refs.logoutButton.disabled = true;
    try { await api('/api/admin/logout', { method: 'POST', body: '{}' }); }
    catch { /* Clear the local view even if the session already expired. */ }
    clearSession();
    refs.logoutButton.disabled = false;
    refs.loginForm.reset();
    refs.loginEmail.value = '';
    showLogin('আপনি সাইন আউট করেছেন।');
  }

  async function loadProducts() {
    refs.error.hidden = true;
    refs.empty.hidden = true;
    refs.pagination.hidden = false;
    refs.range.textContent = 'ক্যাটালগ লোড হচ্ছে…';
    refs.rows.replaceChildren();
    for (let i = 0; i < 6; i += 1) {
      const tr = document.createElement('tr');
      tr.className = 'product-row loading-row';
      const bar = (size) => {
        const element = document.createElement('span');
        element.className = `loading-bar ${size}`;
        element.setAttribute('aria-hidden', 'true');
        return element;
      };
      const identity = document.createElement('td');
      identity.className = 'identity-col';
      const identityWrap = document.createElement('div');
      identityWrap.className = 'identity-cell';
      const thumb = document.createElement('span');
      thumb.className = 'loading-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      copy.className = 'identity-copy loading-copy';
      copy.append(bar('long'), bar('sku-bar'));
      identityWrap.append(thumb, copy);
      identity.append(identityWrap);
      const category = document.createElement('td');
      category.className = 'category-col';
      category.append(bar('medium'));
      const price = document.createElement('td');
      price.className = 'price-col';
      price.append(bar('short'));
      const stock = document.createElement('td');
      stock.className = 'stock-col';
      stock.append(bar('medium'));
      const actions = document.createElement('td');
      actions.className = 'action-col';
      actions.append(bar('action-bar'));
      tr.append(identity, category, price, stock, actions);
      refs.rows.append(tr);
    }
    try {
      const [baseResponse, result] = await Promise.all([
        fetch('/products.json', { cache: 'no-store' }),
        api('/api/admin/products')
      ]);
      if (!baseResponse.ok) throw new ApiError('মূল ক্যাটালগ লোড করা যায়নি।', baseResponse.status);
      const baseProducts = await baseResponse.json();
      if (!Array.isArray(baseProducts) || !Array.isArray(result.edits)) throw new ApiError('ক্যাটালগের তথ্য সঠিক নয়।', 502);
      const merged = new Map(baseProducts.map((product) => [String(product.sku), {
        ...product,
        mainCategory: cleanCategory(product.mainCategory),
        subCategory: cleanCategory(product.subCategory)
      }]));
      result.edits.forEach((edit) => {
        const sku = String(edit.sku || '');
        if (!sku) return;
        if (edit.deleted) { merged.delete(sku); return; }
        if (!edit.product || typeof edit.product !== 'object') return;
        merged.set(sku, {
          ...edit.product,
          mainCategory: cleanCategory(edit.product.mainCategory),
          subCategory: cleanCategory(edit.product.subCategory),
          updatedAt: edit.updatedAt || ''
        });
      });
      state.products = [...merged.values()];
      populateFilters();
      applyFilters();
      setFeedback(refs.resultStatus, '');
    } catch (error) {
      if (error.status === 401) { clearSession(); showLogin('সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করুন।'); return; }
      refs.rows.replaceChildren();
      refs.range.textContent = 'পণ্য লোড করা যায়নি';
      refs.errorText.textContent = error.message || 'ক্যাটালগে সংযোগ করা যায়নি।';
      refs.error.hidden = false;
      refs.pagination.hidden = true;
    }
  }

  function orderedCategories(products) {
    const counts = new Map();
    products.forEach((product) => counts.set(product.mainCategory, (counts.get(product.mainCategory) || 0) + 1));
    const priority = new Map([['ছেলেদের পোশাক', 0], ['জেন্টস উইন্টার', 1]]);
    return [...counts].sort((a, b) => (priority.get(a[0]) ?? 2) - (priority.get(b[0]) ?? 2) || b[1] - a[1] || a[0].localeCompare(b[0], 'bn'));
  }

  function fillDatalist(element, values) {
    element.replaceChildren();
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      element.append(option);
    });
  }

  function populateFilters() {
    const old = refs.category.value;
    refs.category.replaceChildren(new Option('সব বিভাগ', ''));
    const categories = orderedCategories(state.products);
    categories.forEach(([name, count]) => refs.category.add(new Option(`${name} · ${fmt(count)}`, name)));
    if (categories.some(([name]) => name === old)) refs.category.value = old;
    fillDatalist($('mainCategories'), categories.map(([name]) => name));
    fillDatalist($('subCategories'), [...new Set(state.products.map((p) => p.subCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'bn')));
  }

  function applyFilters() {
    const query = refs.search.value.trim().toLocaleLowerCase('bn');
    const category = refs.category.value;
    const stock = refs.stock.value;
    const sort = refs.sort.value;
    const filtered = state.products.filter((product) => {
      if (category && product.mainCategory !== category) return false;
      const productStock = ['in', 'out'].includes(product.stock) ? product.stock : 'unknown';
      if (stock !== 'all' && productStock !== stock) return false;
      if (query && ![product.sku, product.name, product.mainCategory, product.subCategory, product.sizes].join(' ').toLocaleLowerCase('bn').includes(query)) return false;
      return true;
    });
    if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name, 'bn') || String(a.sku).localeCompare(String(b.sku)));
    else if (sort === 'price-asc') filtered.sort((a, b) => Number(a.price) - Number(b.price) || String(a.sku).localeCompare(String(b.sku)));
    else if (sort === 'price-desc') filtered.sort((a, b) => Number(b.price) - Number(a.price) || String(a.sku).localeCompare(String(b.sku)));
    else if (sort === 'updated') filtered.sort((a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || '') || String(a.sku).localeCompare(String(b.sku)));
    else filtered.sort((a, b) => String(a.sku).localeCompare(String(b.sku), 'en', { numeric: true }));
    state.filtered = filtered;
    state.page = 1;
    renderRows();
  }

  function makeCell(className, text) {
    const td = document.createElement('td');
    td.className = className;
    if (text != null) td.textContent = text;
    return td;
  }

  function makeImage(product) {
    const wrapper = document.createElement('div');
    wrapper.className = 'product-thumb';
    const path = String(product.image || '').trim();
    if (path) {
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = '';
      image.src = path;
      image.onerror = () => { wrapper.replaceChildren(); wrapper.textContent = 'ছবি নেই'; };
      wrapper.append(image);
    } else wrapper.textContent = 'ছবি নেই';
    return wrapper;
  }

  function renderRows() {
    const total = state.filtered.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const visible = state.filtered.slice(start, start + PAGE_SIZE);
    refs.rows.replaceChildren();
    visible.forEach((product) => {
      const tr = document.createElement('tr');
      tr.className = 'product-row';
      tr.dataset.sku = product.sku;

      const identity = makeCell('identity-col');
      identity.setAttribute('data-label', 'পণ্য');
      const identityWrap = document.createElement('div');
      identityWrap.className = 'identity-cell';
      identityWrap.append(makeImage(product));
      const copy = document.createElement('div');
      copy.className = 'identity-copy';
      const name = document.createElement('div');
      name.className = 'product-name';
      name.textContent = product.name || 'নাম দেওয়া হয়নি';
      const sku = document.createElement('div');
      sku.className = 'product-sku';
      sku.textContent = `SKU ${product.sku}`;
      copy.append(name, sku);
      identityWrap.append(copy);
      identity.append(identityWrap);

      const category = makeCell('category-col');
      category.setAttribute('data-label', 'বিভাগ');
      const main = document.createElement('div');
      main.className = 'category-name';
      main.textContent = product.mainCategory || 'বিভাগের তথ্য নেই';
      const sub = document.createElement('div');
      sub.className = 'category-sub';
      sub.textContent = product.subCategory || 'উপবিভাগের তথ্য নেই';
      category.append(main, sub);

      const price = makeCell('price-col price-cell', `৳ ${fmt(product.price)}`);
      price.setAttribute('data-label', 'দাম');
      const stock = makeCell('stock-col');
      stock.setAttribute('data-label', 'স্টক');
      const badge = document.createElement('span');
      const status = ['in', 'out'].includes(product.stock) ? product.stock : 'unknown';
      badge.className = `status ${status}`;
      badge.textContent = stockText[status];
      stock.append(badge);

      const actions = makeCell('action-col');
      actions.setAttribute('data-label', 'কাজ');
      const actionWrap = document.createElement('div');
      actionWrap.className = 'row-actions';
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'text-action'; edit.textContent = 'সম্পাদনা';
      edit.setAttribute('aria-label', `${product.name}, SKU ${product.sku} সম্পাদনা করুন`);
      edit.addEventListener('click', () => openEditor(product));
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'text-action delete-action'; remove.textContent = 'মুছুন';
      remove.setAttribute('aria-label', `${product.name}, SKU ${product.sku} মুছুন`);
      remove.addEventListener('click', () => openDelete(product));
      actionWrap.append(edit, remove);
      actions.append(actionWrap);
      tr.append(identity, category, price, stock, actions);
      refs.rows.append(tr);
    });

    refs.empty.hidden = total !== 0;
    refs.range.textContent = total ? `${fmt(start + 1)}–${fmt(Math.min(start + PAGE_SIZE, total))} / ${fmt(total)} পণ্য` : 'কোনো পণ্য পাওয়া যায়নি';
    refs.pageInfo.textContent = `পৃষ্ঠা ${fmt(state.page)} / ${fmt(pages)}`;
    refs.previous.disabled = state.page <= 1;
    refs.next.disabled = state.page >= pages;
  }

  async function getDescription(product) {
    if (typeof product.description === 'string') return product.description;
    const key = product.descriptionKey || 'desc-00';
    if (!state.descriptionCache.has(key)) {
      const promise = fetch(`descriptions/${encodeURIComponent(key)}.json`, { cache: 'force-cache' })
        .then((response) => { if (!response.ok) throw new Error('বিবরণ পাওয়া যায়নি'); return response.json(); });
      state.descriptionCache.set(key, promise);
    }
    try {
      const descriptions = await state.descriptionCache.get(key);
      return typeof descriptions[product.sku] === 'string' ? descriptions[product.sku] : '';
    } catch {
      state.descriptionCache.delete(key);
      return '';
    }
  }

  function resetEditor() {
    refs.productForm.reset();
    refs.sku.readOnly = false;
    refs.sku.removeAttribute('aria-readonly');
    refs.formFeedback.textContent = '';
    refs.formFeedback.className = 'form-feedback';
  }

  async function openEditor(product = null) {
    state.editingSku = product ? String(product.sku) : null;
    resetEditor();
    refs.editorTitle.textContent = product ? 'পণ্যের তথ্য সম্পাদনা' : 'নতুন পণ্য যোগ করুন';
    refs.editorSubtitle.textContent = product ? `SKU ${product.sku} · পরিবর্তনগুলো পাবলিক ক্যাটালগেও দেখা যাবে।` : 'পাবলিক ক্যাটালগে নতুন পণ্য দেখানোর তথ্য দিন।';
    refs.saveButton.textContent = product ? 'পরিবর্তন সংরক্ষণ' : 'পণ্য যোগ করুন';
    refs.saveButton.disabled = Boolean(product);
    if (product) {
      refs.sku.value = product.sku;
      refs.sku.readOnly = true;
      refs.sku.setAttribute('aria-readonly', 'true');
      refs.name.value = product.name || '';
      refs.mainCategory.value = product.mainCategory || '';
      refs.subCategory.value = product.subCategory || '';
      refs.price.value = Number(product.price || 0);
      refs.sizes.value = product.sizes || '';
      refs.productStock.value = ['in', 'out'].includes(product.stock) ? product.stock : 'unknown';
      refs.image.value = product.image || '';
      refs.description.value = 'বিবরণ লোড হচ্ছে…';
      refs.description.disabled = true;
      refs.productDialog.showModal();
      const description = await getDescription(product);
      if (state.editingSku === String(product.sku)) {
        refs.description.value = description;
        refs.description.disabled = false;
        refs.saveButton.disabled = false;
      }
    } else {
      refs.productStock.value = 'in';
      refs.description.disabled = false;
      refs.saveButton.disabled = false;
      refs.productDialog.showModal();
    }
    refs.name.focus();
  }

  async function saveProduct(event) {
    event.preventDefault();
    const product = {
      sku: refs.sku.value.trim(),
      name: refs.name.value.trim(),
      mainCategory: refs.mainCategory.value.trim(),
      subCategory: refs.subCategory.value.trim(),
      price: Number(refs.price.value),
      currency: 'BDT',
      stock: refs.productStock.value,
      stockSource: 'admin',
      inPdf: true,
      sizes: refs.sizes.value.trim(),
      image: refs.image.value.trim(),
      description: refs.description.value.trim()
    };
    if (!product.sku || !product.name || !product.mainCategory || !product.subCategory || !Number.isFinite(product.price) || product.price < 0) {
      setFeedback(refs.formFeedback, 'SKU, নাম, বিভাগ, উপবিভাগ ও সঠিক দাম পূরণ করুন।', 'error');
      return;
    }
    refs.saveButton.disabled = true;
    setFeedback(refs.formFeedback, 'সংরক্ষণ করা হচ্ছে…');
    try {
      const isEdit = Boolean(state.editingSku);
      const query = isEdit ? `?sku=${encodeURIComponent(state.editingSku)}` : '';
      const result = await api(`/api/admin/products${query}`, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify({ product })
      });
      refs.productDialog.close();
      await loadProducts();
      setFeedback(refs.resultStatus, isEdit ? `SKU ${product.sku} হালনাগাদ হয়েছে।` : `SKU ${product.sku} ক্যাটালগে যোগ হয়েছে।`, 'success');
      if (result.product) {
        const saved = state.products.find((item) => String(item.sku) === String(result.product.sku));
        if (saved) { state.page = Math.max(1, Math.ceil((state.filtered.indexOf(saved) + 1) / PAGE_SIZE)); renderRows(); }
      }
    } catch (error) {
      if (error.status === 401) { clearSession(); refs.productDialog.close(); showLogin('সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করুন।'); }
      else setFeedback(refs.formFeedback, error.message || 'পণ্য সংরক্ষণ করা যায়নি।', 'error');
    } finally {
      refs.saveButton.disabled = false;
    }
  }

  function openDelete(product) {
    state.deletingSku = String(product.sku);
    refs.deleteCopy.textContent = `“${product.name}” (SKU ${product.sku}) পাবলিক ক্যাটালগ থেকে সরানো হবে।`;
    setFeedback(refs.deleteFeedback, '');
    refs.deleteDialog.showModal();
    refs.cancelDelete.focus();
  }

  async function deleteProduct(event) {
    event.preventDefault();
    if (!state.deletingSku) return;
    refs.confirmDelete.disabled = true;
    setFeedback(refs.deleteFeedback, 'পণ্য সরানো হচ্ছে…');
    try {
      await api(`/api/admin/products?sku=${encodeURIComponent(state.deletingSku)}`, { method: 'DELETE' });
      const sku = state.deletingSku;
      refs.deleteDialog.close();
      state.deletingSku = null;
      await loadProducts();
      setFeedback(refs.resultStatus, `SKU ${sku} পাবলিক ক্যাটালগ থেকে সরানো হয়েছে।`, 'success');
    } catch (error) {
      if (error.status === 401) { clearSession(); refs.deleteDialog.close(); showLogin('সেশনের মেয়াদ শেষ হয়েছে। আবার সাইন ইন করুন।'); }
      else setFeedback(refs.deleteFeedback, error.message || 'পণ্য মুছতে সমস্যা হয়েছে।', 'error');
    } finally {
      refs.confirmDelete.disabled = false;
    }
  }

  function toggleMobileNav(force) {
    const open = typeof force === 'boolean' ? force : !refs.sidebar.classList.contains('open');
    refs.sidebar.classList.toggle('open', open);
    refs.navScrim.hidden = !open;
    refs.menuButton.setAttribute('aria-expanded', String(open));
    if (open) refs.sidebar.querySelector('.nav-link')?.focus();
    else refs.menuButton.focus();
  }

  refs.loginForm.addEventListener('submit', submitLogin);
  refs.logoutButton.addEventListener('click', logout);
  refs.add.addEventListener('click', () => openEditor());
  refs.emptyAdd.addEventListener('click', () => openEditor());
  refs.productForm.addEventListener('submit', saveProduct);
  refs.closeEditor.addEventListener('click', () => refs.productDialog.close());
  refs.cancelEditor.addEventListener('click', () => refs.productDialog.close());
  refs.deleteForm.addEventListener('submit', deleteProduct);
  refs.cancelDelete.addEventListener('click', () => refs.deleteDialog.close());
  refs.search.addEventListener('input', () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(applyFilters, 100);
  });
  [refs.category, refs.stock, refs.sort].forEach((element) => element.addEventListener('change', applyFilters));
  refs.previous.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; renderRows(); } });
  refs.next.addEventListener('click', () => { if (state.page < Math.ceil(state.filtered.length / PAGE_SIZE)) { state.page += 1; renderRows(); } });
  refs.retry.addEventListener('click', loadProducts);
  refs.menuButton.addEventListener('click', () => toggleMobileNav());
  refs.navScrim.addEventListener('click', () => toggleMobileNav(false));
  refs.sidebar.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => toggleMobileNav(false)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && refs.sidebar.classList.contains('open')) toggleMobileNav(false); });

  checkSession();
})();
