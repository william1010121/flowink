/** Merge enumerable own metadata values without invoking target prototype setters.
 * Targets are internal mutable metadata records; this is not a general-purpose
 * Object.assign replacement for arbitrary descriptors or proxy targets.
 */
export function mergeMetadata(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
    Object.defineProperty(target, key, {
      value: source[key], enumerable: true, writable: true, configurable: true,
    });
  }
  return target;
}
