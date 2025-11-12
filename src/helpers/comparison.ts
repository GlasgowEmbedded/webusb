type FalsyValue = false | null | undefined | 0 | '';

function truthyFilter<T>(value: T | FalsyValue): value is T {
    return !!value;
}

export function onlyTruthy<T>(array: (T | FalsyValue)[]) {
    return array.filter(truthyFilter);
}

type Comparable = string | number | null | Comparable[];

export function equals(...values: [Comparable, Comparable, ...Comparable[]]) {
    for (let idx = 0, len = values.length; idx <= len - 2; idx++) {
        let lhs = values[idx];
        let rhs = values[idx + 1];
        if (typeof lhs !== typeof rhs) return false;
        if ((lhs === null) !== (rhs === null)) return false;
        if (typeof lhs === 'object' && typeof rhs === 'object' && lhs && rhs && ('length' in lhs && 'length' in rhs)) {
            if (lhs.length !== rhs.length) return false;
            for (let idx = 0, len = lhs.length; idx < len; idx++) {
                if (!equals(lhs[idx], rhs[idx])) return false;
            }
        }
        if (lhs !== rhs) return false;
    }
    return true;
}
