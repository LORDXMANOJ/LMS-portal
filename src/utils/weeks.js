// Groups materials and assignments by week_number into a sorted array of
// { number, materials, assignments }. Week 0 ("General") always sorts
// first if present, then Week 1, 2, 3... in order. Only weeks that
// actually have content appear.
function groupByWeek(materials, assignments) {
  const weekMap = new Map();

  function bucket(n) {
    if (!weekMap.has(n)) weekMap.set(n, { number: n, materials: [], assignments: [] });
    return weekMap.get(n);
  }

  materials.forEach((m) => bucket(m.week_number || 0).materials.push(m));
  assignments.forEach((a) => bucket(a.week_number || 0).assignments.push(a));

  return Array.from(weekMap.values()).sort((a, b) => a.number - b.number);
}

module.exports = { groupByWeek };
