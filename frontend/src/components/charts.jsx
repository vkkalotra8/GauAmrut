import { lazy, Suspense } from 'react';
import { money } from '../lib';
import { ChartTip, Empty } from './ui';

const MilkTrendLazy = lazy(async () => {
  const { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } = await import('recharts');
  function Chart({ monthly, gradientId = 'milkFill' }) {
    if (!monthly?.length) return <Empty>Record your first delivery to see the month take shape.</Empty>;
    const points = monthly.map(d => ({ day: d._id.slice(-2), date: d._id, litres: Math.round(d.quantityMl / 10) / 100 }));
    return (
      <div className="chart-host" role="img" aria-label={`Daily delivery volumes: ${monthly.map(d => `${d._id}: ${d.quantityMl / 1000} litres`).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 10, left: -16, bottom: 0 }}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3}/><stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="var(--chart-grid)"/>
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false}/>
            <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={46} tickFormatter={v => `${v} L`}/>
            <Tooltip content={<ChartTip format={(v, key) => (key === 'litres' ? `${v} L` : money(v))}/>} cursor={{ stroke: 'var(--border)', strokeDasharray: '4 4' }}/>
            <Area type="monotone" dataKey="litres" name="Litres" stroke="var(--chart-1)" strokeWidth={2.5} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} animationDuration={800}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return { default: Chart };
});

const CollectionsDonutLazy = lazy(async () => {
  const { Cell, Pie, PieChart, ResponsiveContainer } = await import('recharts');
  const { useTranslation } = await import('react-i18next');
  function Donut({ bills }) {
    const { t } = useTranslation();
    const paidPaise = bills.reduce((n, b) => n + (b.paidPaise || 0), 0);
    const duePaise = bills.reduce((n, b) => n + Math.max(0, b.closingPaise || 0), 0);
    if (paidPaise + duePaise <= 0) return null;
    const collectedLabel = t('payments.collectedLegend', 'Collected');
    const outstandingLabel = t('payments.outstandingLegend', 'Outstanding');
    const pct = Math.round((paidPaise / (paidPaise + duePaise)) * 100);
    const segments = [
      { name: collectedLabel, value: paidPaise, color: 'var(--chart-1)' },
      { name: outstandingLabel, value: duePaise, color: 'var(--chart-2)' }
    ];
    return (
      <div className="donut-wrap">
        <div className="donut-chart" role="img" aria-label={`${collectedLabel}: ${money(paidPaise)}. ${outstandingLabel}: ${money(duePaise)}.`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={segments} dataKey="value" nameKey="name" innerRadius={54} outerRadius={80} paddingAngle={3} cornerRadius={6} stroke="none" isAnimationActive={false}>
                {segments.map(s => <Cell key={s.name} fill={s.color}/>)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center" aria-hidden="true"><b>{pct}%</b><small>{t('payments.collectedShort', 'collected')}</small></div>
        </div>
        <div className="donut-legend">
          {segments.map(s => <span key={s.name}><i className="legend-dot" style={{ background: s.color }}/>{s.name}<b>{money(s.value)}</b></span>)}
        </div>
      </div>
    );
  }
  return { default: Donut };
});

export function MilkTrend(props) { return <Suspense fallback={null}><MilkTrendLazy {...props}/></Suspense>; }
export function CollectionsDonut(props) { return <Suspense fallback={null}><CollectionsDonutLazy {...props}/></Suspense>; }
