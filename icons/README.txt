SCRIGNO - asset per webapp

File inclusi:
- icon-192.png e icon-512.png: icone PWA
- icon-maskable-512.png: icona PWA maskable
- apple-touch-icon.png: icona iOS 180x180
- favicon.ico, favicon-32.png, favicon-16.png: favicon browser
- site.webmanifest: manifest PWA

Nel tag <head> della pagina HTML:
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#041F52">

Copia i file nella directory pubblica principale del sito (ad esempio /public)
e verifica che i percorsi nel manifest corrispondano alla posizione scelta.
