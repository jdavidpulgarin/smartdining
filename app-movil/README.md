# SmartDining — App Móvil (Expo)

Aplicación móvil en React Native + Expo Router para pedidos **Para llevar** y **Domicilio** de SmartDining.

> **Estado actual: Etapa 1 (base sin backend nuevo).**
> El menú, la configuración pública del restaurante, el detalle de platos, el constructor paso a paso y el carrito local con `AsyncStorage` ya funcionan. Las pantallas de Cuenta (login/registro), Checkout (dirección y pago con Wompi) y Seguimiento están diseñadas y marcadas con avisos provisionales mientras llegan los endpoints de backend (D-19, D-20, R-23) y la extracción de lógica compartida a `packages/core` (R-22).

## Requisitos

- Node.js 22+
- npm
- Para probar en teléfono físico: app **Expo Go** en Android/iOS conectada a la misma red Wi-Fi.

## Instalación

```bash
cd app-movil
npm install
```

## Variables de entorno

Copia `.env.example` a `.env` (no hagas commit de `.env`):

```bash
cp .env.example .env
```

Configura la URL pública de la API (sin barra final):

```env
EXPO_PUBLIC_API_URL=https://api.staging.smartdining.com.co
```

> Si `EXPO_PUBLIC_API_URL` no está definida en desarrollo (`__DEV__`), la app carga automáticamente un menú de demostración con un banner visible de **"Modo demo"**.

## Cómo ejecutar

### En Expo Go (Android / iOS)

```bash
cd app-movil
npx expo start
```

1. Asegúrate de que tu computador y tu teléfono estén en la misma red Wi-Fi.
2. Escanea el código QR de la terminal con **Expo Go** (Android) o la cámara (iOS).

### En navegador web

```bash
cd app-movil
npm run web
```

O presiona la tecla `w` después de ejecutar `npx expo start`.

## Verificación

```bash
cd app-movil
npm test
npm run lint
npx expo export --platform web
npx expo-doctor
```
