# MedRecebe no Icon Composer

Camadas vetoriais preparadas para o ícone nativo com Liquid Glass:

1. Importe `01-background.svg`, `02-stethoscope.svg`, `03-check.svg` e `04-diaphragm.svg` nessa ordem.
2. Mantenha o fundo opaco e aplique material vítreo somente nas três camadas do símbolo.
3. Use refração baixa no estetoscópio, média no check e translucidez menor no diafragma verde.
4. Revise as aparências padrão, escura e monocromática em 1024 × 1024.
5. Não adicione máscara de cantos: o sistema faz o recorte final.

O arquivo `../medrecebe-liquid-glass-master.png` é o master achatado usado no PWA e como fallback do Expo. As camadas desta pasta são a fonte recomendada para o projeto iOS gerado no Xcode.
