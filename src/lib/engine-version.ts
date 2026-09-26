/**
 * Engine version stamp.
 *
 * Results are cached in the database (trace + optimised SVG). When the vector
 * engine improves, a cached SVG would keep showing the old quality forever, so
 * every produced result is stamped with this version and a cached result whose
 * stamp differs is re-analysed on the next request.
 *
 * Bump this whenever the pipeline or renderer changes in a user-visible way.
 */
export const ENGINE_VERSION = "2025-09-25.9";
