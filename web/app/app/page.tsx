import Nav from "@/components/Nav"
import AppConsole from "@/components/AppConsole"

export default function AppPage() {
  return (
    <>
      <Nav variant="app" />
      <main id="main" className="container-x" style={{ paddingBlock: "clamp(20px, 3vw, 36px)" }}>
        <AppConsole />
      </main>
    </>
  )
}
