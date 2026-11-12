import { View, Text, StyleSheet } from 'react-native';
import { colores, espaciado } from '../../src/theme';

export default function CuentaScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>CUENTA</Text>
      <Text style={styles.subtitulo}>Inicio de sesión y registro.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colores.fondo,
    padding: espaciado.lg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: espaciado.sm,
  },
  titulo: {
    color: colores.texto,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitulo: {
    color: colores.textoSuave,
    fontSize: 14,
  },
});
