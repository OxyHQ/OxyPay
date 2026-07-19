import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CheckoutSessionRoute } from './routes/CheckoutSessionRoute';
import { PaymentLinkRoute } from './routes/PaymentLinkRoute';
import { PaymentIntentRoute } from './routes/PaymentIntentRoute';
import { NotFoundRoute } from './routes/NotFoundRoute';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/c/:sessionId" element={<CheckoutSessionRoute />} />
        <Route path="/l/:linkId" element={<PaymentLinkRoute />} />
        <Route path="/i/:intentId" element={<PaymentIntentRoute />} />
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
