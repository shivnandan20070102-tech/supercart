import React from 'react';

/**
 * ProductCardSkeleton — visually mirrors the real ProductCard layout
 * (image box, two text lines, price + Add button) with a light shimmer.
 * Same width/height proportions so the grid doesn't jump when data loads.
 */
const ProductCardSkeleton = () => (
  <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs flex flex-col justify-between overflow-hidden">
    {/* Image box — same aspect-square area as ProductCard */}
    <div className="p-4 pb-0 bg-slate-50/50 flex items-center justify-center aspect-square overflow-hidden">
      <div className="w-full h-full sc-skeleton rounded-xl" />
    </div>

    {/* Product details section */}
    <div className="p-4 flex flex-col flex-1 justify-between">
      <div>
        {/* Unit / weight */}
        <div className="h-3 w-12 sc-skeleton rounded mb-2" />
        {/* Title (two lines) */}
        <div className="h-4 w-full sc-skeleton rounded mb-1.5" />
        <div className="h-4 w-3/4 sc-skeleton rounded" />
        {/* Rating + stock */}
        <div className="mt-2 h-3 w-20 sc-skeleton rounded" />
      </div>

      {/* Price + Add/Quantity actions */}
      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="h-5 w-14 sc-skeleton rounded" />
          <div className="h-3 w-10 sc-skeleton rounded" />
        </div>
        <div className="h-9 w-20 sc-skeleton rounded-xl" />
      </div>
    </div>
  </div>
);

export default ProductCardSkeleton;
