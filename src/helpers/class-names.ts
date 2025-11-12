type ConditionalClassName =
    | string | boolean | null | undefined
    | Record<string, boolean | null | undefined>
    | ConditionalClassName[]
    ;

export function cls(...classes: ConditionalClassName[]) {
    classes = classes.flat().map(c => typeof c === 'string' ? c.split(' ') : c).flat().filter(c => c !== '');
    let set = Object.assign({}, ...classes.map(c => typeof c === 'string' ? { [c]: c } : c));
    return Object.keys(set).filter(c => set[c]).join(' ');
}
