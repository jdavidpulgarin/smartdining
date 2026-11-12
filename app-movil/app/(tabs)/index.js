import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colores, espaciado, radios } from '../../src/theme';
import Card from '../../src/components/ui/Card';
import Button from '../../src/components/ui/Button';
import Badge from '../../src/components/ui/Badge';

export default function InicioScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.contenido}>
        <View style={styles.marcaRow}>
          <View style={styles.logoCaja}>
            <Text style={styles.logoTexto}>SD</Text>
          </View>
          <Text style={styles.marcaTexto}>SMARTDINING</Text>
          <Badge variante="acento" style={styles.badgeCanal}>
            Para llevar · Domicilio
          </Badge>
        </View>

        <Card destacada style={styles.heroCard}>
          <Text style={styles.heroEyebrow}>PEDIDOS MÓVILES</Text>
          <Text style={styles.heroTitulo}>TU PLATO FAVORITO, DONDE ESTÉS</Text>
          <Text style={styles.heroSubtitulo}>
            Explora la carta, arma tu plato ingrediente por ingrediente y pide para recoger o a domicilio.
          </Text>
          <View style={styles.acciones}>
            <Button onPress={() => router.push('/(tabs)/menu')}>
              Explorar menú
            </Button>
          </View>
        </Card>

        <View style={styles.grid}>
          <Card style={styles.featureCard}>
            <Text style={styles.featureTitulo}>PARA LLEVAR</Text>
            <Text style={styles.featureTexto}>
              Ordena desde tu celular y recoge en restaurante sin hacer fila.
            </Text>
          </Card>

          <Card style={styles.featureCard}>
            <Text style={styles.featureTitulo}>DOMICILIO</Text>
            <Text style={styles.featureTexto}>
              Recibe tu pedido en casa. Dirección y pago en línea disponibles pronto.
            </Text>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colores.fondo,
  },
  contenido: {
    padding: espaciado.lg,
    gap: espaciado.lg,
  },
  marcaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: espaciado.sm,
    flexWrap: 'wrap',
  },
  logoCaja: {
    width: 36,
    height: 36,
    borderRadius: radios.sm,
    backgroundColor: colores.primario,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoTexto: {
    color: colores.texto,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 1,
  },
  marcaTexto: {
    color: colores.texto,
    fontWeight: '800',
    fontSize: 18,
    letterSpacing: 1.5,
  },
  badgeCanal: {
    marginLeft: 'auto',
  },
  heroCard: {
    gap: espaciado.md,
  },
  heroEyebrow: {
    color: colores.primarioTexto,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  heroTitulo: {
    color: colores.texto,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.5,
    lineHeight: 32,
  },
  heroSubtitulo: {
    color: colores.textoSuave,
    fontSize: 14,
    lineHeight: 20,
  },
  acciones: {
    marginTop: espaciado.xs,
  },
  grid: {
    gap: espaciado.md,
  },
  featureCard: {
    gap: espaciado.xs,
  },
  featureTitulo: {
    color: colores.texto,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  featureTexto: {
    color: colores.textoSuave,
    fontSize: 13,
    lineHeight: 19,
  },
});
