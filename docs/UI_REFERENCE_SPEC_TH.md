# SYY Shop — UI Reference Specification

สถานะ: Approved visual target จากภาพตัวอย่างล่าสุด
Branch implementation: `feature/ui-reference-parity`

## 1. Visual tokens
- Primary: `#0B6FF4`
- Primary dark: `#0757C8`
- Navigation: `#172534`
- Page background: `#F4F7FB`
- Surface/Card: `#FFFFFF`
- Border: `#DFE6EE`
- Text primary: `#182230`
- Text secondary: `#64748B`
- Success: `#16A34A`
- Warning: `#F59E0B`
- Danger: `#EF4444`
- Font: `Noto Sans Thai`, fallback `Inter`, system sans-serif
- Card radius: 12px
- Input/Button radius: 8px
- Desktop control height: 38px
- Mobile control height: 44px

## 2. Navigation
Desktop sidebar grouping:
1. ภาพรวม — Dashboard
2. ขาย — ขาย/ตัดสต๊อก, ใบเสนอราคา, ใบกำกับภาษี
3. คลังและจัดซื้อ — สินค้า, ใบสั่งซื้อ
4. ข้อมูลหลัก — แบรนด์, หมวดหมู่, ผู้จำหน่าย, ลูกค้า, โซน, รถ
5. ระบบ — สำรองข้อมูล, ผู้ใช้งาน, Activity Log

Mobile bottom navigation remains 5 primary destinations: Home, Sale, Products, Documents, More.

## 3. Page header / actions
- One clear primary CTA at right edge.
- Refresh / Export / density are secondary; consolidate into overflow where multiple actions exist.
- Density is a preference, not a primary page action.
- Primary CTA uses solid blue; destructive actions use solid red only after explicit confirmation.

## 4. Dashboard
Target hierarchy:
- Period controls and last-updated state at top.
- KPI row with tinted cards and clear numeric hierarchy.
- Action Center for stock risks, each card navigates directly to a corrective workflow.
- Trend/chart section below KPI/alerts.
- Fast/Slow/Aging insights below trend.
- Stock Health table at bottom with search/filter and product detail drawer.

## 5. Products
- Thumbnail: 46–48 px, `object-fit: contain`, white background.
- Clicking any product image opens dark lightbox.
- Product details use right-side drawer.
- Searchable dropdowns for master references.
- Header keeps `+ เพิ่มสินค้า` visible; secondary actions go to overflow.
- Product gallery: max 6 images.
- First image is primary and remains compatible with legacy `Product_Images`.
- Gallery supports set-primary and delete-one-image.

## 6. Sales / Stock Issue
- Product search/scanner is the first interaction.
- Desktop remains two-column: search/results + sale basket/summary.
- Primary confirm action remains visually dominant.
- Mobile control hit areas minimum 44 px.
- Product images use contain/zoom behavior.

## 7. Purchase Orders
- KPI/status cards visually match Dashboard cards.
- History table remains secondary to operational creation workflow.
- Status should be represented as business state, not generic decoration.

## 8. Quotation
- Document composer keeps left content + right sticky summary model.
- Searchable customer/product controls.
- Primary save action is blue and remains visible.

## 9. Tax Invoice
- Composer must feel like a workspace rather than a small modal.
- Desktop editor expands to near-full viewport.
- Mobile editor uses full screen.
- Buyer, items, totals and print actions remain visually separated.

## 10. Master data
- All master pages use the same card/table/header system.
- Table headers use light gray, not saturated blue.
- Search and filter controls share identical height/radius.
- Row actions remain compact and right-aligned.

## 11. Users / Profile
- Manage Users inherits the same shared palette/table controls.
- Role/status appear as pills; destructive/security actions remain secondary.
- Profile/Security cards use shared surface and spacing rules.

## 12. Responsive
- <= 820 px: controls >=44 px, two-column dashboard KPI/alerts, full-width forms.
- Invoice workspace becomes full viewport.
- Product gallery thumbnails remain touch-friendly.
- No interaction may rely on double-click only.

## 13. Product image data contract
New gallery collection: `Product_Galleries`.
- `Images_JSON`
- `Primary_Image_Url`
- `Image_Count`
- `UpdatedAt`

Primary gallery image is synchronized to legacy `Product_Images`, so existing table/dashboard code continues to read `imageUrl` without migration breakage.

## 14. Acceptance criteria
- Visual hierarchy is consistent with the approved mockup across desktop/mobile.
- Same color/font/radius/control sizing across pages.
- Primary action position is consistent.
- Product images never crop by default.
- Product supports multiple images, lightbox, primary selection and per-image deletion.
- Large reference dropdowns are type-to-search.
- Existing business logic/data is preserved.
