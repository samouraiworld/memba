import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Layout } from "./components/layout/Layout"
import { Dashboard } from "./pages/Dashboard"
import { CreateMultisig } from "./pages/CreateMultisig"
import { ImportMultisig } from "./pages/ImportMultisig"
import { MultisigView } from "./pages/MultisigView"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/create" element={<CreateMultisig />} />
          <Route path="/import" element={<ImportMultisig />} />
          <Route path="/multisig/:address" element={<MultisigView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
