"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, Trash2, Edit, ShoppingBag, ExternalLink, Tag } from 'lucide-react';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import type { Agency, BrandProduct } from '@/types';
import { MediaUpload } from '@/components/ui/media-upload';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ProductCatalogPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [agency, setAgency] = useState<Agency | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<BrandProduct | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState<Omit<BrandProduct, 'id'>>({
    name: '',
    description: '',
    price: 0,
    url: '',
    imageUrl: '',
    videoUrl: '',
    usps: [],
  });

  const [newUSP, setNewUSP] = useState('');

  useEffect(() => {
    if (!user?.primaryAgencyId) {
      if (!authLoading) setLoading(false);
      return;
    }

    const fetchAgency = async () => {
      try {
        const agencyRef = doc(db, 'agencies', user.primaryAgencyId!);
        const snap = await getDoc(agencyRef);
        if (snap.exists()) {
          setAgency(snap.data() as Agency);
        }
      } catch (error) {
        console.error("Error fetching agency:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAgency();
  }, [user, authLoading]);

  const handleSaveProduct = async () => {
    if (!user?.primaryAgencyId || !agency) return;
    setSaving(true);
    try {
      const agencyRef = doc(db, 'agencies', user.primaryAgencyId);
      let updatedProducts = [...(agency.products || [])];

      if (editingProduct) {
        updatedProducts = updatedProducts.map(p => 
          p.id === editingProduct.id ? { ...formData, id: p.id } : p
        );
      } else {
        const newProduct: BrandProduct = {
          ...formData,
          id: crypto.randomUUID(),
        };
        updatedProducts.push(newProduct);
      }

      await updateDoc(agencyRef, {
        products: updatedProducts,
        updatedAt: new Date(),
      });

      setAgency({ ...agency, products: updatedProducts });
      toast({ 
        title: editingProduct ? "Product Updated" : "Product Added", 
        description: `${formData.name} has been saved to your catalog.` 
      });
      setIsDialogOpen(false);
      resetForm();
    } catch (error: any) {
      console.error("Error saving product:", error);
      toast({ title: "Save Failed", description: error.message || "Could not save product.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!user?.primaryAgencyId || !agency) return;
    if (!confirm("Are you sure you want to delete this product?")) return;

    try {
      const agencyRef = doc(db, 'agencies', user.primaryAgencyId);
      const updatedProducts = (agency.products || []).filter(p => p.id !== id);

      await updateDoc(agencyRef, {
        products: updatedProducts,
        updatedAt: new Date(),
      });

      setAgency({ ...agency, products: updatedProducts });
      toast({ title: "Product Deleted", description: "The product has been removed from your catalog." });
    } catch (error: any) {
      console.error("Error deleting product:", error);
      toast({ title: "Delete Failed", description: error.message || "Could not delete product.", variant: "destructive" });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      price: 0,
      url: '',
      imageUrl: '',
      videoUrl: '',
      usps: [],
    });
    setEditingProduct(null);
    setNewUSP('');
  };

  const openEditDialog = (product: BrandProduct) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description,
      price: product.price,
      url: product.url,
      imageUrl: product.imageUrl,
      videoUrl: product.videoUrl || '',
      usps: product.usps || [],
    });
    setIsDialogOpen(true);
  };

  const addUSP = () => {
    if (!newUSP.trim()) return;
    setFormData({ ...formData, usps: [...formData.usps, newUSP.trim()] });
    setNewUSP('');
  };

  const removeUSP = (index: number) => {
    const newUSPs = [...formData.usps];
    newUSPs.splice(index, 1);
    setFormData({ ...formData, usps: newUSPs });
  };

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }


  return (
    <div className="space-y-6 pb-12">
      <PageHeader 
        title="Product Catalog" 
        description="Manage the products you want creators to promote in their campaigns."
        actions={
          <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[525px] max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingProduct ? 'Edit Product' : 'Add New Product'}</DialogTitle>
                <DialogDescription>
                  Enter the details of the product. This information will be visible to creators.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="name" className="text-right">Name</Label>
                  <Input 
                    id="name" 
                    value={formData.name} 
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="col-span-3" 
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="price" className="text-right">Price ($)</Label>
                  <Input 
                    id="price" 
                    type="number"
                    value={formData.price} 
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value.toString()) || 0 })}
                    className="col-span-3" 
                  />
                </div>
                <div className="grid grid-cols-4 items-start gap-4">
                  <Label htmlFor="description" className="text-right mt-2">Description</Label>
                  <Textarea 
                    id="description" 
                    value={formData.description} 
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="col-span-3 min-h-[80px]" 
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label htmlFor="url" className="text-right">Product URL</Label>
                  <Input 
                    id="url" 
                    value={formData.url} 
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    className="col-span-3" 
                    placeholder="https://yourstore.com/product"
                  />
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Product Image</Label>
                  <div className="col-span-3">
                    <MediaUpload 
                      value={formData.imageUrl} 
                      onChange={(url) => setFormData({ ...formData, imageUrl: url })}
                      onRemove={() => setFormData({ ...formData, imageUrl: '' })}
                      label="Main Product Shot"
                      accept="image/*"
                      folder="products/images"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 items-center gap-4">
                  <Label className="text-right">Product Video</Label>
                  <div className="col-span-3">
                    <MediaUpload 
                      value={formData.videoUrl} 
                      onChange={(url) => setFormData({ ...formData, videoUrl: url })}
                      onRemove={() => setFormData({ ...formData, videoUrl: '' })}
                      label="Motion / B-Roll"
                      accept="video/*"
                      folder="products/videos"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-4 items-start gap-4">
                  <Label className="text-right mt-2">USPs</Label>
                  <div className="col-span-3 space-y-2">
                    <div className="flex gap-2">
                      <Input 
                        value={newUSP} 
                        onChange={(e) => setNewUSP(e.target.value)}
                        placeholder="e.g. 100% Organic"
                        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addUSP())}
                      />
                      <Button type="button" variant="secondary" size="icon" onClick={addUSP}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {formData.usps.map((usp, index) => (
                        <div key={index} className="bg-primary/10 text-primary px-2 py-1 rounded-md text-xs flex items-center gap-1">
                          {usp}
                          <button onClick={() => removeUSP(index)} className="hover:text-primary/70">
                            <Plus className="h-3 w-3 rotate-45" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleSaveProduct} disabled={saving || !formData.name}>
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingProduct ? 'Save Changes' : 'Add Product'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-primary" />
            Product List
          </CardTitle>
          <CardDescription>All products currently available in your brand catalog.</CardDescription>
        </CardHeader>
        <CardContent>
          {agency?.products && agency.products.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Image</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>USPs</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agency.products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt={product.name} className="h-10 w-10 object-cover rounded-md border" />
                      ) : (
                        <div className="h-10 w-10 bg-muted rounded-md flex items-center justify-center">
                          <ShoppingBag className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{product.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">{product.description}</div>
                    </TableCell>
                    <TableCell>${product.price.toFixed(2)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {product.usps?.slice(0, 2).map((usp, i) => (
                          <div key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded flex items-center gap-1">
                            <Tag className="h-2 w-2" />
                            {usp}
                          </div>
                        ))}
                        {product.usps?.length > 2 && <div className="text-[10px] text-muted-foreground">+{product.usps.length - 2} more</div>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {product.url && (
                          <Button variant="ghost" size="icon" asChild>
                            <a href={product.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(product)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteProduct(product.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12 space-y-4">
              <div className="bg-primary/5 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                <ShoppingBag className="h-8 w-8 text-primary" />
              </div>
              <div className="space-y-1">
                <h3 className="font-semibold text-lg">No products yet</h3>
                <p className="text-muted-foreground max-w-sm mx-auto">
                  Add your first product to the catalog to help creators choose what to promote in their content.
                </p>
              </div>
              <Button onClick={() => setIsDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Your First Product
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
