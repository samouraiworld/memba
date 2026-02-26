import { BrowserRouter, Routes, Route } from "react-router-dom"
import { Layout } from "./components/layout/Layout"
import { Dashboard } from "./pages/Dashboard"
import { CreateMultisig } from "./pages/CreateMultisig"
import { ImportMultisig } from "./pages/ImportMultisig"
import { MultisigView } from "./pages/MultisigView"
import { ProposeTransaction } from "./pages/ProposeTransaction"
import { TransactionView } from "./pages/TransactionView"
import { CreateToken } from "./pages/CreateToken"
import { TokenDashboard } from "./pages/TokenDashboard"
import { TokenView } from "./pages/TokenView"

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/create" element={<CreateMultisig />} />
          <Route path="/import" element={<ImportMultisig />} />
          <Route path="/multisig/:address" element={<MultisigView />} />
          <Route path="/multisig/:address/propose" element={<ProposeTransaction />} />
          <Route path="/tx/:id" element={<TransactionView />} />
          <Route path="/create-token" element={<CreateToken />} />
          <Route path="/tokens" element={<TokenDashboard />} />
          <Route path="/tokens/:symbol" element={<TokenView />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
