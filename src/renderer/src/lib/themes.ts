/**
 * Colour themes.
 *
 * Every theme is the same eighteen CSS custom properties, written onto
 * `<html>` at runtime. Everything else in `styles.css` is derived from them with
 * `color-mix()`, so a new theme needs no CSS at all -- add an entry here and it
 * works, including the soft badge fills and the hover tints.
 *
 * Palettes are the published ones for each editor theme, adapted where a theme
 * has no equivalent of a colour this UI needs (Rosé Pine has no green, for
 * instance, and the status dots need one).
 */

export type ThemeToken =
  | 'bg'
  | 'bg-raised'
  | 'bg-inset'
  | 'panel'
  | 'border'
  | 'border-strong'
  | 'text'
  | 'text-dim'
  | 'text-faint'
  | 'accent'
  | 'accent-hover'
  | 'accent-fg'
  | 'green'
  | 'amber'
  | 'red'
  | 'violet'
  | 'pink'
  | 'cyan'

export interface Theme {
  id: string
  name: string
  /** Drives the scrollbar/native-widget scheme, the shadow weight and the scrim. */
  dark: boolean
  colors: Record<ThemeToken, string>
}

export const THEMES: Theme[] = [
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    dark: true,
    colors: {
      bg: '#0d1117',
      'bg-raised': '#141b24',
      'bg-inset': '#0a0e14',
      panel: '#161d27',
      border: '#232c38',
      'border-strong': '#303c4c',
      text: '#e6edf3',
      'text-dim': '#8b98a9',
      'text-faint': '#5d6b7d',
      accent: '#4c8dff',
      'accent-hover': '#6ba0ff',
      'accent-fg': '#ffffff',
      green: '#3fb950',
      amber: '#d29922',
      red: '#f85149',
      violet: '#a371f7',
      pink: '#f778ba',
      cyan: '#39c5cf'
    }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    dark: true,
    colors: {
      bg: '#282828',
      'bg-raised': '#32302f',
      'bg-inset': '#1d2021',
      panel: '#32302f',
      border: '#3c3836',
      'border-strong': '#504945',
      text: '#ebdbb2',
      'text-dim': '#bdae93',
      'text-faint': '#928374',
      accent: '#fe8019',
      'accent-hover': '#ff9d4d',
      'accent-fg': '#282828',
      green: '#b8bb26',
      amber: '#fabd2f',
      red: '#fb4934',
      violet: '#d3869b',
      pink: '#f2a2b4',
      cyan: '#8ec07c'
    }
  },
  {
    id: 'gruvbox-material',
    name: 'Gruvbox Material',
    dark: true,
    colors: {
      bg: '#282828',
      'bg-raised': '#32302f',
      'bg-inset': '#232323',
      panel: '#32302f',
      border: '#3c3836',
      'border-strong': '#45403d',
      text: '#d4be98',
      'text-dim': '#a89984',
      'text-faint': '#7c6f64',
      accent: '#7daea3',
      'accent-hover': '#9bc6bc',
      'accent-fg': '#282828',
      green: '#a9b665',
      amber: '#d8a657',
      red: '#ea6962',
      violet: '#d3869b',
      pink: '#e39aae',
      cyan: '#89b482'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: true,
    colors: {
      bg: '#282a36',
      'bg-raised': '#343746',
      'bg-inset': '#21222c',
      panel: '#343746',
      border: '#44475a',
      'border-strong': '#565a71',
      text: '#f8f8f2',
      'text-dim': '#a5a8b6',
      'text-faint': '#6272a4',
      accent: '#bd93f9',
      'accent-hover': '#d0adff',
      'accent-fg': '#282a36',
      green: '#50fa7b',
      amber: '#ffb86c',
      red: '#ff5555',
      violet: '#bd93f9',
      pink: '#ff79c6',
      cyan: '#8be9fd'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    colors: {
      bg: '#2e3440',
      'bg-raised': '#3b4252',
      'bg-inset': '#272c36',
      panel: '#3b4252',
      border: '#434c5e',
      'border-strong': '#4c566a',
      text: '#eceff4',
      'text-dim': '#c8d0dd',
      'text-faint': '#7b88a1',
      accent: '#88c0d0',
      'accent-hover': '#a3d3e0',
      'accent-fg': '#2e3440',
      green: '#a3be8c',
      amber: '#ebcb8b',
      red: '#bf616a',
      violet: '#b48ead',
      pink: '#d3899f',
      cyan: '#8fbcbb'
    }
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    dark: true,
    colors: {
      bg: '#1a1b26',
      'bg-raised': '#24283b',
      'bg-inset': '#16161e',
      panel: '#24283b',
      border: '#2f3549',
      'border-strong': '#414868',
      text: '#c0caf5',
      'text-dim': '#9aa5ce',
      'text-faint': '#565f89',
      accent: '#7aa2f7',
      'accent-hover': '#9cb8f9',
      'accent-fg': '#1a1b26',
      green: '#9ece6a',
      amber: '#e0af68',
      red: '#f7768e',
      violet: '#bb9af7',
      pink: '#ff9ec4',
      cyan: '#7dcfff'
    }
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    dark: true,
    colors: {
      bg: '#1e1e2e',
      'bg-raised': '#313244',
      'bg-inset': '#181825',
      panel: '#282839',
      border: '#313244',
      'border-strong': '#45475a',
      text: '#cdd6f4',
      'text-dim': '#a6adc8',
      'text-faint': '#6c7086',
      accent: '#89b4fa',
      'accent-hover': '#a8c8fb',
      'accent-fg': '#1e1e2e',
      green: '#a6e3a1',
      amber: '#f9e2af',
      red: '#f38ba8',
      violet: '#cba6f7',
      pink: '#f5c2e7',
      cyan: '#94e2d5'
    }
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    dark: true,
    colors: {
      bg: '#282c34',
      'bg-raised': '#2c313a',
      'bg-inset': '#21252b',
      panel: '#2c313a',
      border: '#3a4149',
      'border-strong': '#4b5363',
      text: '#dcdfe4',
      'text-dim': '#abb2bf',
      'text-faint': '#5c6370',
      accent: '#61afef',
      'accent-hover': '#82c0f5',
      'accent-fg': '#282c34',
      green: '#98c379',
      amber: '#e5c07b',
      red: '#e06c75',
      violet: '#c678dd',
      pink: '#d47bb0',
      cyan: '#56b6c2'
    }
  },
  {
    id: 'monokai',
    name: 'Monokai',
    dark: true,
    colors: {
      bg: '#272822',
      'bg-raised': '#33342c',
      'bg-inset': '#1e1f1c',
      panel: '#33342c',
      border: '#3e3d32',
      'border-strong': '#57564a',
      text: '#f8f8f2',
      'text-dim': '#b9b8a8',
      'text-faint': '#75715e',
      accent: '#f92672',
      'accent-hover': '#fd5a92',
      'accent-fg': '#ffffff',
      green: '#a6e22e',
      amber: '#e6db74',
      red: '#f92672',
      violet: '#ae81ff',
      pink: '#f92672',
      cyan: '#66d9ef'
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    dark: true,
    colors: {
      bg: '#002b36',
      'bg-raised': '#073642',
      'bg-inset': '#00212b',
      panel: '#073642',
      border: '#0f4c5c',
      'border-strong': '#586e75',
      text: '#93a1a1',
      'text-dim': '#839496',
      'text-faint': '#586e75',
      accent: '#268bd2',
      'accent-hover': '#4ba3e3',
      'accent-fg': '#ffffff',
      green: '#859900',
      amber: '#b58900',
      red: '#dc322f',
      violet: '#6c71c4',
      pink: '#d33682',
      cyan: '#2aa198'
    }
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    dark: true,
    colors: {
      bg: '#011627',
      'bg-raised': '#0b2942',
      'bg-inset': '#010e1a',
      panel: '#0b2942',
      border: '#1d3b53',
      'border-strong': '#2d4f6c',
      text: '#d6deeb',
      'text-dim': '#8badc1',
      'text-faint': '#637777',
      accent: '#82aaff',
      'accent-hover': '#a5c3ff',
      'accent-fg': '#011627',
      green: '#addb67',
      amber: '#ecc48d',
      red: '#ef5350',
      violet: '#c792ea',
      pink: '#f78fb3',
      cyan: '#7fdbca'
    }
  },
  {
    id: 'everforest-dark',
    name: 'Everforest Dark',
    dark: true,
    colors: {
      bg: '#2d353b',
      'bg-raised': '#343f44',
      'bg-inset': '#272e33',
      panel: '#343f44',
      border: '#3d484d',
      'border-strong': '#4f585e',
      text: '#d3c6aa',
      'text-dim': '#9da9a0',
      'text-faint': '#7a8478',
      accent: '#7fbbb3',
      'accent-hover': '#a1cfc8',
      'accent-fg': '#2d353b',
      green: '#a7c080',
      amber: '#dbbc7f',
      red: '#e67e80',
      violet: '#d699b6',
      pink: '#e69fb4',
      cyan: '#83c092'
    }
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    dark: true,
    colors: {
      bg: '#191724',
      'bg-raised': '#1f1d2e',
      'bg-inset': '#14121f',
      panel: '#1f1d2e',
      border: '#26233a',
      'border-strong': '#403d52',
      text: '#e0def4',
      'text-dim': '#908caa',
      'text-faint': '#6e6a86',
      accent: '#c4a7e7',
      'accent-hover': '#d6c1f0',
      'accent-fg': '#191724',
      green: '#7fc8a9',
      amber: '#f6c177',
      red: '#eb6f92',
      violet: '#c4a7e7',
      pink: '#ebbcba',
      cyan: '#9ccfd8'
    }
  },
  {
    id: 'kanagawa',
    name: 'Kanagawa',
    dark: true,
    colors: {
      bg: '#1f1f28',
      'bg-raised': '#2a2a37',
      'bg-inset': '#16161d',
      panel: '#2a2a37',
      border: '#363646',
      'border-strong': '#54546d',
      text: '#dcd7ba',
      'text-dim': '#b6b096',
      'text-faint': '#727169',
      accent: '#7e9cd8',
      'accent-hover': '#9db3e3',
      'accent-fg': '#1f1f28',
      green: '#98bb6c',
      amber: '#e6c384',
      red: '#e46876',
      violet: '#957fb8',
      pink: '#d27e99',
      cyan: '#7aa89f'
    }
  },
  {
    id: 'ayu-dark',
    name: 'Ayu Dark',
    dark: true,
    colors: {
      bg: '#0d1017',
      'bg-raised': '#171b22',
      'bg-inset': '#08090e',
      panel: '#171b22',
      border: '#1f2430',
      'border-strong': '#2f3640',
      text: '#bfbdb6',
      'text-dim': '#8a8986',
      'text-faint': '#565b66',
      accent: '#e6b450',
      'accent-hover': '#f0c46a',
      'accent-fg': '#0d1017',
      green: '#aad94c',
      amber: '#ffb454',
      red: '#f07178',
      violet: '#d2a6ff',
      pink: '#e57fa8',
      cyan: '#95e6cb'
    }
  },
  {
    id: 'material-ocean',
    name: 'Material Ocean',
    dark: true,
    colors: {
      bg: '#0f111a',
      'bg-raised': '#1a1c25',
      'bg-inset': '#090b10',
      panel: '#1a1c25',
      border: '#232633',
      'border-strong': '#333747',
      text: '#cdd3e8',
      'text-dim': '#a6accd',
      'text-faint': '#6b7089',
      accent: '#82aaff',
      'accent-hover': '#a3c0ff',
      'accent-fg': '#0f111a',
      green: '#c3e88d',
      amber: '#ffcb6b',
      red: '#f07178',
      violet: '#c792ea',
      pink: '#ff9cbb',
      cyan: '#89ddff'
    }
  },
  {
    id: 'synthwave-84',
    name: "Synthwave '84",
    dark: true,
    colors: {
      bg: '#262335',
      'bg-raised': '#34294f',
      'bg-inset': '#1a1527',
      panel: '#2f2445',
      border: '#453a63',
      'border-strong': '#5a4a80',
      text: '#f4eeff',
      'text-dim': '#a396c9',
      'text-faint': '#7a6ea3',
      accent: '#ff7edb',
      'accent-hover': '#ff9ee6',
      'accent-fg': '#1a1527',
      green: '#72f1b8',
      amber: '#fede5d',
      red: '#fe4450',
      violet: '#b381c5',
      pink: '#ff7edb',
      cyan: '#36f9f6'
    }
  },
  {
    id: 'cobalt2',
    name: 'Cobalt2',
    dark: true,
    colors: {
      bg: '#193549',
      'bg-raised': '#1f4662',
      'bg-inset': '#12293a',
      panel: '#1f4662',
      border: '#27536f',
      'border-strong': '#35708f',
      text: '#ffffff',
      'text-dim': '#9fbfd4',
      'text-faint': '#6f93a8',
      accent: '#ffc600',
      'accent-hover': '#ffd740',
      'accent-fg': '#193549',
      green: '#3ad900',
      amber: '#ff9d00',
      red: '#ff628c',
      violet: '#fb94ff',
      pink: '#ff628c',
      cyan: '#80fcff'
    }
  },
  {
    id: 'zenburn',
    name: 'Zenburn',
    dark: true,
    colors: {
      bg: '#3f3f3f',
      'bg-raised': '#4a4a4a',
      'bg-inset': '#363636',
      panel: '#484848',
      border: '#555555',
      'border-strong': '#6a6a6a',
      text: '#dcdccc',
      'text-dim': '#b4b49b',
      'text-faint': '#8f8f7f',
      accent: '#8cd0d3',
      'accent-hover': '#a8dfe1',
      'accent-fg': '#2b2b2b',
      green: '#7f9f7f',
      amber: '#f0dfaf',
      red: '#cc9393',
      violet: '#dc8cc3',
      pink: '#ecbcbc',
      cyan: '#93e0e3'
    }
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    dark: false,
    colors: {
      bg: '#ffffff',
      'bg-raised': '#f6f8fa',
      'bg-inset': '#f6f8fa',
      panel: '#ffffff',
      border: '#d0d7de',
      'border-strong': '#afb8c1',
      text: '#1f2328',
      'text-dim': '#59636e',
      'text-faint': '#818b98',
      accent: '#0969da',
      'accent-hover': '#0550ae',
      'accent-fg': '#ffffff',
      green: '#1a7f37',
      amber: '#9a6700',
      red: '#cf222e',
      violet: '#8250df',
      pink: '#bf3989',
      cyan: '#1b7c83'
    }
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    dark: false,
    colors: {
      bg: '#fbf1c7',
      'bg-raised': '#ebdbb2',
      'bg-inset': '#f2e5bc',
      panel: '#fbf1c7',
      border: '#ddccab',
      'border-strong': '#bdae93',
      text: '#3c3836',
      'text-dim': '#665c54',
      'text-faint': '#928374',
      accent: '#af3a03',
      'accent-hover': '#c14a10',
      'accent-fg': '#fbf1c7',
      green: '#79740e',
      amber: '#b57614',
      red: '#9d0006',
      violet: '#8f3f71',
      pink: '#b16286',
      cyan: '#427b58'
    }
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    dark: false,
    colors: {
      bg: '#fdf6e3',
      'bg-raised': '#eee8d5',
      'bg-inset': '#eee8d5',
      panel: '#fdf6e3',
      border: '#ded8c4',
      'border-strong': '#c6bfa8',
      text: '#073642',
      'text-dim': '#586e75',
      'text-faint': '#93a1a1',
      accent: '#268bd2',
      'accent-hover': '#1a6fab',
      'accent-fg': '#ffffff',
      green: '#859900',
      amber: '#b58900',
      red: '#dc322f',
      violet: '#6c71c4',
      pink: '#d33682',
      cyan: '#2aa198'
    }
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    dark: false,
    colors: {
      bg: '#eff1f5',
      'bg-raised': '#dce0e8',
      'bg-inset': '#e6e9ef',
      panel: '#f8f9fb',
      border: '#ccd0da',
      'border-strong': '#b3b8c6',
      text: '#4c4f69',
      'text-dim': '#6c6f85',
      'text-faint': '#9ca0b0',
      accent: '#1e66f5',
      'accent-hover': '#1552d4',
      'accent-fg': '#ffffff',
      green: '#40a02b',
      amber: '#df8e1d',
      red: '#d20f39',
      violet: '#8839ef',
      pink: '#ea76cb',
      cyan: '#179299'
    }
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    dark: false,
    colors: {
      bg: '#faf4ed',
      'bg-raised': '#fffaf3',
      'bg-inset': '#f2e9e1',
      panel: '#fffaf3',
      border: '#e4dcd4',
      'border-strong': '#cfc4bb',
      text: '#575279',
      'text-dim': '#797593',
      'text-faint': '#9893a5',
      accent: '#907aa9',
      'accent-hover': '#7b6392',
      'accent-fg': '#ffffff',
      green: '#4f9d69',
      amber: '#ea9d34',
      red: '#b4637a',
      violet: '#907aa9',
      pink: '#d7827e',
      cyan: '#56949f'
    }
  },
  {
    id: 'ayu-light',
    name: 'Ayu Light',
    dark: false,
    colors: {
      bg: '#fcfcfc',
      'bg-raised': '#f3f4f5',
      'bg-inset': '#f8f9fa',
      panel: '#ffffff',
      border: '#e2e4e6',
      'border-strong': '#c8cbcf',
      text: '#5c6166',
      'text-dim': '#787b80',
      'text-faint': '#a0a6ac',
      // Ayu's own #fa8d3e is 2.3:1 on this background -- unreadable as a link and
      // as a button label. Darkened until both clear 4:1.
      accent: '#c85a12',
      'accent-hover': '#a94a08',
      'accent-fg': '#ffffff',
      green: '#86b300',
      amber: '#f2ae49',
      red: '#f07171',
      violet: '#a37acc',
      pink: '#d9629f',
      cyan: '#4cbf99'
    }
  }
]

export const DEFAULT_THEME_ID = 'github-dark'

export function findTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/**
 * Writes a theme onto `<html>`. Inline custom properties beat the `:root` rule in
 * `styles.css`, which therefore holds the defaults and every derived colour.
 */
export function applyTheme(id: string): Theme {
  const theme = findTheme(id)
  const root = document.documentElement

  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${token}`, value)
  }

  // Not part of the palette: a scrim and a drop shadow tuned for dark backgrounds
  // are far too heavy over a light one.
  root.style.setProperty('--overlay', theme.dark ? 'rgba(1, 4, 9, 0.72)' : 'rgba(48, 52, 62, 0.4)')
  root.style.setProperty(
    '--shadow-lg',
    theme.dark ? '0 16px 48px rgba(0, 0, 0, 0.55)' : '0 16px 48px rgba(60, 66, 80, 0.22)'
  )
  root.style.setProperty(
    '--shadow-up',
    theme.dark ? '0 -8px 24px rgba(0, 0, 0, 0.35)' : '0 -8px 24px rgba(60, 66, 80, 0.14)'
  )
  // Lets Chromium draw form controls and the scrollbar for the right scheme.
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  root.dataset.theme = theme.id

  return theme
}
