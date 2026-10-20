const { charge, fingerprint, eligible, csvCell } = require('../src/domain');
describe('Accounting and input invariants', () => {
  test('calculates charges using integer arithmetic and explicit half-up rounding', () => {
    expect(charge(1500, 6050)).toBe(9075);
    expect(charge(125, 6004)).toBe(751);
    expect(charge(0, 6000)).toBe(0);
    expect(() => charge(1.5, 6000)).toThrow();
    expect(() => charge(-100, 6000)).toThrow();
    expect(() => charge(Number.MAX_SAFE_INTEGER, 1000 * 1000)).toThrow();
  });
  test('canonical request hashes are independent of property ordering', () => {
    expect(fingerprint({ x: 1, y: { b: 2, a: 3 } })).toBe(fingerprint({ y: { a: 3, b: 2 }, x: 1 }));
    expect(fingerprint({ quantity: 1 })).not.toBe(fingerprint({ quantity: 2 }));
  });
  test('service eligibility respects inclusive dates and active state', () => {
    const customer = { status: 'active', startDate: '2026-01-01', endDate: '2026-01-31' };
    expect(eligible(customer, '2026-01-01')).toBe(true);
    expect(eligible(customer, '2026-01-31')).toBe(true);
    expect(eligible(customer, '2026-02-01')).toBe(false);
    expect(eligible({ ...customer, status: 'inactive' }, '2026-01-15')).toBe(false);
  });
  test.each(['=HYPERLINK("bad")', '+1', '-1', '@SUM(A1)', '  =1+1', '\t=1+1'])('neutralizes CSV formula: %s', input => {
    expect(csvCell(input).startsWith('"\'')).toBe(true);
  });
  test('CSV quotes embedded quotes and newlines', () => { expect(csvCell('A,"B"\nC')).toBe('"A,""B""\nC"'); });
});
