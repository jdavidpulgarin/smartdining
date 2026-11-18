import { View, StyleSheet } from 'react-native';
import { colores, radios, espaciado } from '../../theme';

export default function Card({ children, destacada = false, style }) {
  return (
    <View style={[styles.card, destacada && styles.destacada, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colores.superficie,
    borderRadius: radios.lg,
    borderWidth: 1,
    borderColor: colores.borde,
    padding: espaciado.lg,
  },
  destacada: {
    borderWidth: 2,
    borderColor: colores.primario,
  },
});
