import Nav from './components/Nav.jsx'
import Hero from './components/Hero.jsx'
import WorksWith from './components/WorksWith.jsx'
import Orchestration from './components/Orchestration.jsx'
import FeatureGrid from './components/FeatureGrid.jsx'
import HowItWorks from './components/HowItWorks.jsx'
import TerminalDemo from './components/TerminalDemo.jsx'
import SecuritySection from './components/SecuritySection.jsx'
import InstallSection from './components/InstallSection.jsx'
import FAQ from './components/FAQ.jsx'
import Footer from './components/Footer.jsx'

// Reading order: claim → proof of breadth → how the work is assembled →
// the surfaces you touch → the sequence of a run → an honest run →
// limits → install → questions → credits.
export default function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div id="top" />
      <Nav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <WorksWith />
        <Orchestration />
        <FeatureGrid />
        <HowItWorks />
        <TerminalDemo />
        <SecuritySection />
        <InstallSection />
        <FAQ />
      </main>
      <Footer />
    </>
  )
}
