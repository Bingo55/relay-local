import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

export default {
    darkMode: ['class'],
    content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
  	extend: {
  		colors: {
  			background: 'var(--color-paper)',
  			foreground: 'var(--color-ink)',
  			border: 'var(--color-rule)',
  			input: 'var(--color-muted)',
  			ring: 'var(--color-focus)',
  			primary: {
  				DEFAULT: 'var(--color-ink)',
  				foreground: 'var(--color-paper)'
  			},
  			secondary: {
  				DEFAULT: 'var(--color-paper-2)',
  				foreground: 'var(--color-ink)'
  			},
  			muted: {
  				DEFAULT: 'var(--color-paper-2)',
  				foreground: 'var(--color-muted)'
  			},
  			accent: {
  				DEFAULT: 'var(--color-paper-3)',
  				foreground: 'var(--color-ink)'
  			},
  			destructive: {
  				DEFAULT: 'var(--color-error)',
  				foreground: 'var(--color-paper)'
  			},
  			popover: {
  				DEFAULT: 'var(--color-paper)',
  				foreground: 'var(--color-ink)'
  			},
  			card: {
  				DEFAULT: 'var(--color-paper)',
  				foreground: 'var(--color-ink)'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		fontFamily: {
  			sans: [
  				'var(--font-body)'
  			],
  			mono: [
  				'var(--font-outlier)'
  			]
  		},
  		borderRadius: {
  			lg: 'var(--radius-card)',
  			md: 'var(--radius-input)',
  			sm: 'var(--radius-small)'
  		}
   	}
  },
  plugins: [animate],
} satisfies Config
