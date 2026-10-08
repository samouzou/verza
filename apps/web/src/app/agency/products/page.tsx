"use client";

import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2, Edit, ShoppingBag, ExternalLink, Tag } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { BrandProduct } from '@/types';
import { ProductDialog } from '@/components/agency/product-dialog';
import { productImages, useBrandProducts, type BrandProductInput } from '@/hooks/use-brand-products';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function ProductCatalogPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { products, loading, upsert, remove } = useBrandProducts(user?.primaryAgencyId);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<BrandProduct | null>(null);
  const { toast } = useToast();

  const handleSaveProduct = async (input: BrandProductInput) => {
    try {
      await upsert(input, editingProduct?.id);
      toast({
        title: editingProduct ? "Product Updated" : "Product Added",
        description: `${input.name} has been saved to your catalog.`
      });
    } catch (error: any) {
      console.error("Error saving product:", error);
      toast({ title: "Save Failed", description: error.message || "Could not save product.", variant: "destructive" });
      throw error;
    }
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm("Are you sure you want to delete this product?")) return;
    try {
      await remove(id);
      toast({ title: "Product Deleted", description: "The product has been removed from your catalog." });
    } catch (error: any) {
      console.error("Error deleting product:", error);
      toast({ title: "Delete Failed", description: error.message || "Could not delete product.", variant: "destructive" });
    }
  };

  const openDialog = (product: BrandProduct | null) => {
    setEditingProduct(product);
    setIsDialogOpen(true);
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
        description="Manage the products you want creators to promote, and that Prism features in posts and graphics."
        actions={
          <Button onClick={() => openDialog(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        }
      />

      <ProductDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        product={editingProduct}
        onSave={handleSaveProduct}
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
          {products.length > 0 ? (
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
                {products.map((product) => {
                  const images = productImages(product);
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        {images[0] ? (
                          <div className="relative h-10 w-10">
                            <img src={images[0]} alt={product.name} className="h-10 w-10 object-cover rounded-md border" />
                            {images.length > 1 && (
                              <span className="absolute -bottom-1 -right-1 rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                                {images.length}
                              </span>
                            )}
                          </div>
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
                      <TableCell>${(product.price || 0).toFixed(2)}</TableCell>
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
                          <Button variant="ghost" size="icon" onClick={() => openDialog(product)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => void handleDeleteProduct(product.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
              <Button onClick={() => openDialog(null)}>
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
