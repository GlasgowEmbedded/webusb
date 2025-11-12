type FalsyValue = false | null | undefined | 0 | '';

function truthyFilter<T>(value: T | FalsyValue): value is T {
    return !!value;
}

export function onlyTruthy<T>(array: (T | FalsyValue)[]) {
    return array.filter(truthyFilter);
}
