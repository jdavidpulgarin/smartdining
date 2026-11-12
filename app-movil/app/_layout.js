import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CarritoProvider } from '../src/context/CarritoContext';
import { colores } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CarritoProvider>
        <StatusBar style="light" backgroundColor={colores.fondo} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colores.superficie },
            headerTintColor: colores.texto,
            headerTitleStyle: { fontWeight: '700', letterSpacing: 0.6 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colores.fondo },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="plato/[id]"
            options={{ title: 'Detalle del plato', headerBackTitle: 'Menú' }}
          />
          <Stack.Screen
            name="armar/[id]"
            options={{ title: 'Armar mi plato', headerBackTitle: 'Menú' }}
          />
          <Stack.Screen
            name="checkout"
            options={{ title: 'Finalizar pedido', headerBackTitle: 'Carrito' }}
          />
          <Stack.Screen
            name="seguimiento"
            options={{ title: 'Seguimiento', headerBackTitle: 'Volver' }}
          />
        </Stack>
      </CarritoProvider>
    </SafeAreaProvider>
  );
}
