import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colores, espaciado } from '../../src/theme';

export default function PlatoDetalleScreen() {
  const { id } = useLocalSearchParams();
  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Detalle del plato #{id}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colores.fondo,
    padding: espaciado.lg,
  },
  titulo: {
    color: colores.texto,
    fontSize: 20,
    fontWeight: '800',
  },
});
