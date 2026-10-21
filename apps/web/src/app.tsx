import { Navigate, Route, Routes } from 'react-router';
import { getSurface } from './api/auth';
import { AdminInventory } from './routes/admin/inventory';
import { AdminInventoryCount } from './routes/admin/inventory-count';
import { AdminInventoryDelivery } from './routes/admin/inventory-delivery';
import { AdminLayout } from './routes/admin/layout';
import { AdminMenu } from './routes/admin/menu';
import { AdminOverview } from './routes/admin/overview';
import { AdminSaleNew } from './routes/admin/sale-new';
import { AdminSales } from './routes/admin/sales';
import { AdminSettings } from './routes/admin/settings';
import { Kitchen } from './routes/kitchen';
import { Order } from './routes/order';
import { Pair } from './routes/pair';

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={<Navigate to={`/${getSurface() ?? 'order'}`} replace />}
      />
      <Route path="/order" element={<Order />} />
      <Route path="/kitchen" element={<Kitchen />} />
      <Route path="/pair" element={<Pair />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminOverview />} />
        <Route path="menu" element={<AdminMenu />} />
        <Route path="menu/:categoryId" element={<AdminMenu />} />
        <Route path="inventory" element={<AdminInventory />} />
        <Route path="inventory/delivery" element={<AdminInventoryDelivery />} />
        <Route path="inventory/count" element={<AdminInventoryCount />} />
        <Route
          path="inventory/update"
          element={<Navigate to="/admin/inventory" replace />}
        />
        <Route path="sales" element={<AdminSales />} />
        <Route path="sales/new" element={<AdminSaleNew />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
