// ============================================================
// SYY Shop P0 Cache Invalidation Policy
// Keep high-frequency stock operations from evicting unrelated caches.
// ============================================================

function p0InvalidateProductDataOnly_(includeImageLookup) {
  try { p0CacheRemove_(P0_PRODUCT_CACHE_KEY); } catch (e) { console.error('p0 product cache invalidation:', e); }
  if (includeImageLookup) {
    try { clearCollectionCache(PRODUCT_IMAGES_COLLECTION || 'Product_Images'); } catch (e2) { console.error('p0 image cache invalidation:', e2); }
  }
}

function p0InvalidateStockData_() {
  // Stock changes affect mapped product stock and dashboard movement aggregates,
  // but they do not change Product_Images.
  p0InvalidateProductDataOnly_(false);
  try { p0InvalidateDashboard_(); } catch (e) { console.error('p0 dashboard cache invalidation:', e); }
}

function p0InvalidateGalleryData_() {
  // Gallery changes affect product primary image lookup but not stock movements.
  p0InvalidateProductDataOnly_(true);
}
