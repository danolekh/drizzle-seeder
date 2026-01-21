export class DuplicateChecker<T> {
  private seen = new Set<T>();

  add(value: T): boolean {
    if (this.seen.has(value)) {
      return false;
    }
    this.seen.add(value);
    return true;
  }

  search(value: T): boolean {
    return this.seen.has(value);
  }

  clear(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}
