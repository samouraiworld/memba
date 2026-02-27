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
import { DAOList } from "./pages/DAOList"
import { DAOHome } from "./pages/DAOHome"
import { ProposalView } from "./pages/ProposalView"
import { DAOMembers } from "./pages/DAOMembers"
import { ProposeDAO } from "./pages/ProposeDAO"
import { Treasury } from "./pages/Treasury"
import { TreasuryProposal } from "./pages/TreasuryProposal"
import { CreateDAO } from "./pages/CreateDAO"

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
          {/* DAO Hub + parameterized DAO routes */}
          <Route path="/dao" element={<DAOList />} />
          <Route path="/dao/create" element={<CreateDAO />} />
          <Route path="/dao/:slug" element={<DAOHome />} />
          <Route path="/dao/:slug/proposal/:id" element={<ProposalView />} />
          <Route path="/dao/:slug/members" element={<DAOMembers />} />
          <Route path="/dao/:slug/propose" element={<ProposeDAO />} />
          <Route path="/dao/:slug/treasury" element={<Treasury />} />
          <Route path="/dao/:slug/treasury/propose" element={<TreasuryProposal />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
