"""Exact model of the Dienstplaner month problem for OR-Tools CP-SAT.

Same decision and cost as makeEval() in src/js/scheduler.js: per person and day one candidate
duty or none; hard rules as constraints, soft rules as weighted objective terms (align is not
modelled; export.mjs refuses problems that use it). Costs are scaled by SCALE to integers.

Purpose: measure how far the app's search is from the best possible plan of a month. Developer
tool, not part of the app; needs Python 3 and OR-Tools (pip install ortools). Results and method:
docs/generator.md, section "Distance to the optimum".

Usage (problem.json from export.mjs):
  python3 model.py problem.json check <baseline index>   -> model cost of an app plan; must
                                                            equal the app's own cost (run first)
  python3 model.py problem.json solve <seconds> [hint]   -> best plan found and proven lower
                                                            bound; "hint" starts from the app's
                                                            best plan. NOQUAD=1 drops the
                                                            variance terms (gives a weaker bound
                                                            quickly). Writes problem.exact.json.
"""
import json
import sys
from ortools.sat.python import cp_model

SCALE = 1800  # divisible by 9 (variance over 3 persons / 3 pairs, squared n), by 4 and by 60
import os
NOQUAD = os.environ.get('NOQUAD') == '1'  # drop the variance terms (>= 0): optimum is a lower bound


def build(D, fix=None):
    m = cp_model.CpModel()
    W = D['W']
    nP, nD, nW = D['nP'], D['nD'], D['nW']
    cells = D['cells']
    days = D['days']
    obj = []  # (coef in points, expr)

    x = [[[m.NewBoolVar(f'x{p}_{d}_{c}') for c in range(len(cells[p][d]['cands']))] for d in range(nD)] for p in range(nP)]
    work = [[None] * nD for _ in range(nP)]
    for p in range(nP):
        for d in range(nD):
            cell = cells[p][d]
            xs = x[p][d]
            w = m.NewBoolVar(f'w{p}_{d}')
            if xs:
                m.Add(sum(xs) == w)
            else:
                m.Add(w == 0)
            work[p][d] = w
            if cell['forced'] or (cell['fixed'] and xs):
                m.Add(w == 1)
            for c, cand in enumerate(cell['cands']):
                if cand['lin']:
                    obj.append((cand['lin'], xs[c]))
            if cell['offCost']:
                obj.append((cell['offCost'], 1 - w))
            if fix is not None:
                ch = fix[p][d]
                for c, v in enumerate(xs):
                    m.Add(v == (1 if c == ch else 0))

    # coverage per half-hour cell; cov[p][d][i] = 1 if p works cell i on day d (linear expression)
    def cov(p, d, i):
        t = i * D['STEP']
        return sum(v for c, v in enumerate(x[p][d]) if cells[p][d]['cands'][c]['from'] <= t < cells[p][d]['cands'][c]['to'])

    cnt = [[sum(cov(p, d, i) for p in range(nP)) for i in range(48)] for d in range(nD)]
    for d in range(nD):
        for i in range(48):
            n = D['need'][d][i]
            if n > 0:
                s = m.NewIntVar(0, n, f'short{d}_{i}')
                m.Add(s >= n - cnt[d][i])
                obj.append((W['coverage'], s))

    # weekly coverage: on `required` days of the week the window must be covered
    for k, r in enumerate(D['weekly']):
        oks = []
        for d in r['days']:
            ok = m.NewBoolVar(f'wok{k}_{d}')
            for i in range(r['a'], r['b']):
                m.Add(cnt[d][i] >= r['min']).OnlyEnforceIf(ok)
            oks.append(ok)
        miss = m.NewIntVar(0, r['required'], f'wmiss{k}')
        m.Add(miss >= r['required'] - sum(oks))
        obj.append((W['weeklyCoverage'], miss))

    for p in range(nP):
        person = D['people'][p]
        # late rule (hard): late end on one day, early start the next day
        if D['lateOn']:
            def late(d):
                return sum(v for c, v in enumerate(x[p][d]) if cells[p][d]['cands'][c]['to'] > D['lateEnd'])

            def early(d):
                return sum(v for c, v in enumerate(x[p][d]) if cells[p][d]['cands'][c]['from'] < D['lateNext'])
            if D['prevEnd'][p] > D['lateEnd']:
                m.Add(early(0) == 0)
            for d in range(1, nD):
                m.Add(late(d - 1) + early(d) <= 1)
        # consecutive days
        if person['avoidConsecutive']:
            for d in range(1, nD):
                y = m.NewBoolVar(f'cons{p}_{d}')
                m.Add(y >= work[p][d] + work[p][d - 1] - 1)
                obj.append((W['consecutive'], y))
        # weekly hours: |worked - target| in minutes, weight per hour
        for wk in range(nW):
            worked = sum(cells[p][d]['cands'][c]['len'] * v for d in range(nD) if days[d]['w'] == wk for c, v in enumerate(x[p][d]))
            tgt = D['target'][p][wk]
            assert abs(tgt - round(tgt)) < 1e-9, 'target not integer minutes'
            dev = m.NewIntVar(0, 10000, f'hdev{p}_{wk}')
            m.Add(dev >= worked - round(tgt))
            m.Add(dev >= round(tgt) - worked)
            obj.append((W['hours'] / 60, dev))
        # weekly wishes (start inside [a, b) on `need` days)
        for j, wish in enumerate(D['wishes'][p]):
            for wk in range(nW):
                need = wish['need'][wk]
                if need <= 0:
                    continue
                have = sum(v for d in range(nD) if days[d]['w'] == wk for c, v in enumerate(x[p][d]) if wish['a'] <= cells[p][d]['cands'][c]['from'] < wish['b'])
                miss = m.NewIntVar(0, need, f'wish{p}_{j}_{wk}')
                m.Add(miss >= need - have)
                obj.append((W['weeklyWish'], miss))
        # weekend duties per month
        if person['active']:
            we = sum(work[p][d] for d in range(nD) if days[d]['weekend'])
            dev = m.NewIntVar(0, 20, f'wedev{p}')
            m.Add(dev >= we - D['perMonth'])
            m.Add(dev >= D['perMonth'] - we)
            obj.append((W['weekend'], dev))
        # duties only for an appointment
        ao = sum(v for d in range(nD) for c, v in enumerate(x[p][d]) if cells[p][d]['cands'][c]['apptOnly'])
        ex = m.NewIntVar(0, 40, f'aoex{p}')
        m.Add(ex >= ao - D['apptOnlyMax'])
        obj.append((W['apptOnly'], ex))

    # empty weekends
    anys = []
    for g, grp in enumerate(D['weekends']):
        a = m.NewBoolVar(f'wefill{g}')
        m.Add(a <= sum(work[p][d] for p in range(nP) for d in grp))
        anys.append(a)
    if anys:
        ex = m.NewIntVar(0, len(anys), 'emptyex')
        m.Add(ex >= len(anys) - sum(anys) - D['maxEmptyWeekends'])
        obj.append((W['emptyWeekend'], ex))

    # variance terms: W * sum (v - mean)^2 = W/n^2 * sum (n*v - sum v)^2 (every square >= 0,
    # which gives the solver a usable lower bound)
    quad = []

    def variance(name, vals, ub, weight):
        n = len(vals)
        if n < 2 or not weight or NOQUAD:
            return
        tot = sum(vals)
        sq = []
        for k, v in enumerate(vals):
            dv = m.NewIntVar(-ub * n, ub * n, f'{name}dev{k}')
            m.Add(dv == n * v - tot)
            s = m.NewIntVar(0, (ub * n) ** 2, f'{name}sq{k}')
            m.AddMultiplicationEquality(s, [dv, dv])
            sq.append(s)
        quad.append((weight / n / n, sum(sq)))

    act = [p for p in range(nP) if D['people'][p]['active']]
    variance('bal', [D['hist'][p] + sum(work[p][d] for d in range(nD) if D['balanceDays'][d]) for p in act], 60, W['balanceDay'])
    if W.get('lateBalance'):
        variance('late', [sum(v for d in range(nD) for c, v in enumerate(x[p][d]) if cells[p][d]['cands'][c]['to'] > D['lateEnd']) for p in act], 40, W['lateBalance'])
    # shared time of pairs, in half hours h; ((30h - mean)/60)^2 = (h - mean_h)^2 / 4
    if len(D['pairs']) > 1 and W['pairs']:
        hs = []
        for k, (p, q) in enumerate(D['pairs']):
            terms = []
            for d in range(nD):
                for i in range(48):
                    a, b = cov(p, d, i), cov(q, d, i)
                    if isinstance(a, int) or isinstance(b, int):
                        continue
                    z = m.NewBoolVar(f'ov{k}_{d}_{i}')
                    m.Add(z <= a)
                    m.Add(z <= b)
                    m.Add(z >= a + b - 1)
                    terms.append(z)
            hs.append(sum(terms))
        variance('pair', hs, 48 * nD, W['pairs'] / 4)

    total = sum(round(c * SCALE) * e for c, e in obj) + sum(round(c * SCALE) * e for c, e in quad)
    for c, _ in obj + quad:
        assert abs(c * SCALE - round(c * SCALE)) < 1e-6, f'weight {c} not exact at SCALE {SCALE}'
    m.Minimize(total)
    return m, x


def choice_of(solver, D, x):
    return [[next((c for c, v in enumerate(x[p][d]) if solver.Value(v)), -1) for d in range(D['nD'])] for p in range(D['nP'])]


def main():
    D = json.load(open(sys.argv[1]))
    mode = sys.argv[2]
    if mode == 'check':
        b = D['baselines'][int(sys.argv[3])]
        m, x = build(D, fix=b['choice'])
        s = cp_model.CpSolver()
        s.parameters.max_time_in_seconds = 60
        st = s.Solve(m)
        print('status', s.StatusName(st), 'model cost', s.ObjectiveValue() / SCALE, 'app cost', round(b['cost'], 3))
        return
    secs = float(sys.argv[3])
    m, x = build(D)
    if len(sys.argv) > 4:  # start from the best app plan
        b = min(D['baselines'], key=lambda r: r['cost'])
        for p in range(D['nP']):
            for d in range(D['nD']):
                for c, v in enumerate(x[p][d]):
                    m.AddHint(v, 1 if c == b['choice'][p][d] else 0)
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = secs
    s.parameters.num_workers = 8
    s.parameters.log_search_progress = False

    class Log(cp_model.CpSolverSolutionCallback):
        def on_solution_callback(self):
            print(f'  t={self.WallTime():6.1f}s  plan {self.ObjectiveValue() / SCALE:8.1f}  lower bound {self.BestObjectiveBound() / SCALE:8.1f}', flush=True)
    st = s.Solve(m, Log())
    print('status', s.StatusName(st), 'best', s.ObjectiveValue() / SCALE, 'bound', s.BestObjectiveBound() / SCALE, 'time', round(s.WallTime(), 1))
    out = sys.argv[1].replace('.json', '.exact.json')
    json.dump({'cost': s.ObjectiveValue() / SCALE, 'bound': s.BestObjectiveBound() / SCALE, 'status': s.StatusName(st), 'choice': choice_of(s, D, x)}, open(out, 'w'))
    print('written', out)


if __name__ == '__main__':
    main()
