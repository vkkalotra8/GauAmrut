import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Plus, Edit2, Trash2, Check, X, ShoppingBag, Eye, EyeOff } from 'lucide-react';
import { Heading, Notice, State, Empty, Modal, Field } from '../../components/ui';
import { api, money, message, decimalUnits } from '../../lib';
import useData from '../../hooks/useData';
import { demoProducts } from '../../demo';

export default function Products() {
  const { t } = useTranslation();
  const demo = useSelector(s => s.session.demo);
  const resource = useData('/products', demoProducts);

  const [modal, setModal] = useState(null); // 'add' | { ...product }
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const openAdd = () => {
    setModal('add');
    setError('');
  };

  const openEdit = (product) => {
    setModal(product);
    setError('');
  };

  async function handleSave(e) {
    e.preventDefault();
    if (demo) {
      setError(t('common.demoReadonly', 'Demo workspace: sign in to manage products.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const f = Object.fromEntries(new FormData(e.currentTarget));
      const payload = {
        name: f.name.trim(),
        type: f.type,
        unit: f.unit,
        pricePaise: decimalUnits(f.price),
        description: f.description ? f.description.trim() : '',
        available: f.available === 'on' || f.available === 'true'
      };

      if (modal === 'add') {
        await api.post('/products', payload);
        setNotice(t('products.savedNotice', 'Product added to catalogue successfully.'));
      } else {
        await api.patch(`/products/${modal._id}`, payload);
        setNotice(t('products.savedNotice', 'Product updated successfully.'));
      }
      setModal(null);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleAvailability(product) {
    if (demo) {
      setNotice('Demo mode: sign in to update product availability.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/products/${product._id}`, { available: !product.available });
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(product) {
    if (demo) {
      setNotice('Demo mode: sign in to delete products.');
      setDeletingProduct(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.delete(`/products/${product._id}`);
      setNotice(t('products.deletedNotice', 'Product removed from catalogue.'));
      setDeletingProduct(null);
      resource.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading
        eyebrow={t('products.eyebrow', 'FARM FRESH DAIRY PRODUCTS')}
        title={t('products.title', 'Product Catalogue')}
        description={t('products.description', 'Manage your dairy’s products such as ghee, paneer, curd, butter, and raw milk.')}
      >
        <button type="button" className="button primary" onClick={openAdd}>
          <Plus size={18} /> {t('products.addProduct', 'Add Product')}
        </button>
      </Heading>

      {notice && <Notice>{notice}</Notice>}
      {error && <Notice error>{error}</Notice>}

      <section className="card">
        <State resource={resource}>
          {resource.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('products.name', 'Product Name')}</th>
                    <th>{t('products.type', 'Category')}</th>
                    <th>{t('products.unit', 'Unit')}</th>
                    <th>{t('products.price', 'Price')}</th>
                    <th>{t('common.status', 'Status')}</th>
                    <th>{t('common.actions', 'Actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {resource.data.map(p => (
                    <tr key={p._id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <b>{p.name}</b>
                          {p.description && (
                            <small style={{ color: 'var(--muted-foreground)', maxWidth: '300px', whiteSpace: 'normal' }}>
                              {p.description}
                            </small>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="pill capitalize">{p.type}</span>
                      </td>
                      <td>{p.unit}</td>
                      <td>
                        <b style={{ color: 'var(--success-foreground)' }}>{money(p.pricePaise)}</b>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`status ${p.available ? '' : 'neutral'}`}
                          style={{ cursor: 'pointer', border: '1px solid currentColor' }}
                          title="Click to toggle availability"
                          onClick={() => handleToggleAvailability(p)}
                          disabled={busy}
                        >
                          {p.available ? (
                            <>
                              <Check size={12} /> {t('products.available', 'Available')}
                            </>
                          ) : (
                            <>
                              <X size={12} /> {t('products.unavailable', 'Unavailable')}
                            </>
                          )}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => openEdit(p)}
                            title="Edit product"
                          >
                            <Edit2 size={15} /> {t('common.edit', 'Edit')}
                          </button>
                          <button
                            type="button"
                            className="text-button danger-text"
                            onClick={() => setDeletingProduct(p)}
                            title="Delete product"
                          >
                            <Trash2 size={15} /> {t('common.delete', 'Delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              <ShoppingBag size={40} style={{ opacity: 0.5, marginBottom: '8px' }} />
              <p>{t('products.noProducts', 'No products in catalogue yet. Add your first product to start taking customer orders.')}</p>
            </Empty>
          )}
        </State>
      </section>

      {/* Add / Edit Product Modal */}
      {modal && (
        <Modal
          title={modal === 'add' ? t('products.addProduct', 'Add Product') : t('products.editProduct', 'Edit Product')}
          close={() => setModal(null)}
        >
          <form onSubmit={handleSave}>
            <Field
              label={t('products.name', 'Product Name')}
              name="name"
              required
              minLength={2}
              maxLength={100}
              defaultValue={modal !== 'add' ? modal.name : ''}
              placeholder="e.g., A2 Cow Ghee 500ml"
            />

            <div className="form-grid">
              <label className="field">
                <span>{t('products.type', 'Category')}</span>
                <select name="type" defaultValue={modal !== 'add' ? modal.type : 'other'}>
                  <option value="milk">Milk</option>
                  <option value="ghee">Ghee</option>
                  <option value="paneer">Paneer</option>
                  <option value="curd">Curd (Dahi)</option>
                  <option value="butter">Butter (Makkhan)</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="field">
                <span>{t('products.unit', 'Unit of Measurement')}</span>
                <select name="unit" defaultValue={modal !== 'add' ? modal.unit : 'pack'}>
                  <option value="pack">pack</option>
                  <option value="piece">piece</option>
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                  <option value="L">L</option>
                  <option value="ml">ml</option>
                </select>
              </label>
            </div>

            <Field
              label={t('products.price', 'Price in Rupees (₹)')}
              name="price"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={modal !== 'add' ? (modal.pricePaise / 100).toFixed(2) : ''}
              placeholder="e.g. 120.00"
            />

            <label className="field">
              <span>{t('products.descriptionLabel', 'Description')}</span>
              <textarea
                name="description"
                rows={3}
                maxLength={500}
                defaultValue={modal !== 'add' ? modal.description : ''}
                placeholder="Product details, packaging, shelf life..."
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  width: '100%',
                  fontFamily: 'inherit',
                  fontSize: '13px'
                }}
              />
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '14px 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                name="available"
                defaultChecked={modal === 'add' ? true : modal.available}
              />
              <span style={{ fontSize: '13px', fontWeight: '500' }}>
                {t('products.available', 'Available for customer orders')}
              </span>
            </label>

            {error && <Notice error>{error}</Notice>}

            <button type="submit" className="button primary full" disabled={busy}>
              {busy ? t('common.saving', 'Saving…') : modal === 'add' ? t('products.addProduct', 'Add Product') : t('common.save', 'Save Changes')}
            </button>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deletingProduct && (
        <Modal
          title={t('common.delete', 'Delete Product')}
          close={() => setDeletingProduct(null)}
        >
          <p className="form-note">
            Are you sure you want to remove <b>{deletingProduct.name}</b> from your catalogue?
            Existing orders with snapshotted prices will remain intact in history.
          </p>
          {error && <Notice error>{error}</Notice>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button
              type="button"
              className="button"
              onClick={() => setDeletingProduct(null)}
              disabled={busy}
            >
              {t('common.cancel', 'Cancel')}
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => handleDelete(deletingProduct)}
              disabled={busy}
            >
              {busy ? t('common.saving', 'Deleting…') : t('common.delete', 'Delete')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
