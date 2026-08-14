import { useMemo, useState } from 'react'
import { AlertTriangle, PackageX, RefreshCw, Search } from 'lucide-react'
import type { PackageInfo, PackageScanResult, UpdateSeverity } from '@shared/types'

interface Props {
  result: PackageScanResult | null
  loading: boolean
  selected: Set<string>
  onToggle: (name: string) => void
  onToggleAll: (names: string[], checked: boolean) => void
}

const SEVERITY_LABEL: Record<UpdateSeverity, string> = {
  major: 'Major behind',
  minor: 'Minor behind',
  patch: 'Patch behind',
  current: 'Up to date',
  missing: 'Not installed',
  unknown: 'Unknown'
}

const SEVERITY_COLOR: Record<UpdateSeverity, string> = {
  major: 'var(--red)',
  minor: 'var(--amber)',
  patch: 'var(--amber)',
  current: 'var(--green)',
  missing: 'var(--red)',
  unknown: 'var(--text-faint)'
}

type Filter = 'all' | 'outdated'

export default function PackageTable({
  result,
  loading,
  selected,
  onToggle,
  onToggleAll
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    if (!result) return []
    const q = query.trim().toLowerCase()
    return result.packages.filter((p) => {
      if (filter === 'outdated' && !isUpdatable(p)) return false
      return q === '' || p.name.toLowerCase().includes(q)
    })
  }, [result, query, filter])

  const updatable = useMemo(
    () => (result?.packages ?? []).filter(isUpdatable).map((p) => p.name),
    [result]
  )

  const visibleUpdatable = rows.filter(isUpdatable).map((p) => p.name)
  const allVisibleChecked =
    visibleUpdatable.length > 0 && visibleUpdatable.every((n) => selected.has(n))

  if (loading && !result) {
    return (
      <div className="empty">
        <RefreshCw size={26} className="spin" />
        <h3>Checking the registry&hellip;</h3>
        <p>Reading installed versions and comparing them against npm.</p>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="empty">
        <PackageX size={26} />
        <h3>No package data yet</h3>
        <p>Hit Check for updates to scan this project&rsquo;s dependencies.</p>
      </div>
    )
  }

  if (result.packages.length === 0) {
    return (
      <div className="empty">
        <PackageX size={26} />
        <h3>No dependencies declared</h3>
        <p>This project&rsquo;s package.json has no dependencies to track.</p>
      </div>
    )
  }

  return (
    <>
      {result.outdatedError && (
        <div className="banner warn">
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <div>
            Could not reach the npm registry, so only installed versions are shown.
            <div style={{ opacity: 0.8, fontSize: 12, marginTop: 3 }}>{result.outdatedError}</div>
          </div>
        </div>
      )}

      <div className="pkg-toolbar">
        <div className="search">
          <Search size={14} color="var(--text-faint)" />
          <input
            placeholder="Filter packages"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <button
          className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : ''}`}
          onClick={() => setFilter('all')}
        >
          All {result.packages.length}
        </button>
        <button
          className={`btn btn-sm ${filter === 'outdated' ? 'btn-primary' : ''}`}
          onClick={() => setFilter('outdated')}
        >
          Outdated {updatable.length}
        </button>

        <div style={{ flex: 1 }} />

        <div className="legend">
          <div className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--red)' }} /> major
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--amber)' }} /> minor/patch
          </div>
          <div className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--green)' }} /> current
          </div>
        </div>
      </div>

      <div className="card">
        <table className="pkg-table">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  className="checkbox"
                  aria-label="Select all updatable packages"
                  checked={allVisibleChecked}
                  disabled={visibleUpdatable.length === 0}
                  onChange={(e) => onToggleAll(visibleUpdatable, e.target.checked)}
                />
              </th>
              <th>Package</th>
              <th style={{ width: 110 }}>Installed</th>
              <th style={{ width: 110 }}>Wanted</th>
              <th style={{ width: 110 }}>Latest</th>
              <th style={{ width: 130 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((pkg) => (
              <tr key={pkg.name}>
                <td>
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label={`Select ${pkg.name}`}
                    checked={selected.has(pkg.name)}
                    disabled={!isUpdatable(pkg)}
                    onChange={() => onToggle(pkg.name)}
                  />
                </td>
                <td>
                  <div className="pkg-name">
                    <span>{pkg.name}</span>
                    {pkg.type === 'devDependencies' && <span className="dep-tag">dev</span>}
                    {pkg.type === 'peerDependencies' && <span className="dep-tag">peer</span>}
                    {pkg.type === 'optionalDependencies' && <span className="dep-tag">opt</span>}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                      color: 'var(--text-faint)',
                      marginTop: 2
                    }}
                  >
                    {pkg.range}
                  </div>
                </td>
                <td className={`pkg-version sev-${pkg.severity}`}>{pkg.current ?? '—'}</td>
                <td className="pkg-version" style={{ color: wantedColor(pkg) }}>
                  {pkg.wanted ?? '—'}
                </td>
                <td className="pkg-version" style={{ color: SEVERITY_COLOR[pkg.severity] }}>
                  {pkg.latest ?? '—'}
                </td>
                <td style={{ fontSize: 12, color: SEVERITY_COLOR[pkg.severity] }}>
                  {SEVERITY_LABEL[pkg.severity]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="empty" style={{ padding: '36px 20px' }}>
            <p style={{ margin: 0 }}>
              {filter === 'outdated'
                ? 'Every dependency is on its latest version.'
                : `No package matches "${query}".`}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

/** A package is actionable when something newer than the installed version exists. */
export function isUpdatable(pkg: PackageInfo): boolean {
  if (pkg.severity === 'missing') return true
  if (!pkg.current) return true
  return (
    (pkg.wanted !== null && pkg.wanted !== pkg.current) ||
    (pkg.latest !== null && pkg.latest !== pkg.current)
  )
}

function wantedColor(pkg: PackageInfo): string {
  if (!pkg.current || !pkg.wanted) return 'var(--text-faint)'
  return pkg.wanted === pkg.current ? 'var(--text-faint)' : 'var(--amber)'
}
