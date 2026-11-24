// Doble de consulta Mongoose compartido: solo las pruebas recortan fixtures en memoria.
export function mockList(replace, Model, factory) {
  let current;
  const find = replace(Model, 'find', (...args) => {
    let pending, offset = 0, maximum = Infinity;
    const raw = () => pending ??= Promise.resolve().then(() => factory(...args)).then(value => value?.lean ? value.lean() : value);
    const query = {
      sort() { return query; },
      skip(value) { offset = value; return query; },
      limit(value) { maximum = value; return query; },
      lean() { return query; },
      then(resolve, reject) { return raw().then(rows => [...rows].sort((a, b) => String(a._id).localeCompare(String(b._id))).slice(offset, offset + maximum)).then(resolve, reject); },
      total: () => raw().then(rows => rows.length),
    };
    current = query;
    return query;
  });
  replace(Model, 'countDocuments', () => current.total());
  return find;
}
export function pageOf(data, total = data.length, page = 1, limit = 10) {
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
