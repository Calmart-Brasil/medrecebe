# Monetização no iOS

O backend e o checkout web do Mercado Pago estão em `supabase/` e `docs/BILLING_ADMIN.md`. O aplicativo nativo não deve abrir esse checkout em produção sem a configuração StoreKit exigida para o Brasil.

## Estratégia recomendada

- TestFlight: conta de teste e assinatura sem custo.
- Produção global: assinatura auto-renovável com StoreKit.
- Produção no Brasil, se aprovado: opção alternativa via Mercado Pago somente em iOS 26.5+, com StoreKit External Purchases or Offers Entitlement, tela informativa oficial, elegibilidade por storefront e relatórios de transações externas.

O acesso deve ser concedido pelo backend e funcionar em todos os aparelhos do assinante. Nunca use apenas um marcador local para liberar recursos pagos.
